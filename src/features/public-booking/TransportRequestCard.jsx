import { useEffect, useState } from 'react'
import Notice from '../../components/Notice.jsx'
import { getTransportState, requestTransport } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { whatsappUrl } from '../../lib/format.js'
import { customerWhatsappUrl } from '../transport/transportCalc.js'

const emptyForm = { street: '', number: '', neighborhood: '', city: '', complement: '', reference: '' }

/**
 * Depois do agendamento: o cliente pode solicitar o leva e traz (so se o servico oferece).
 * Ele informa o endereco e e levado ao WhatsApp do estabelecimento com uma mensagem pronta.
 * Nao mostra nem envia valor: quem cota e o estabelecimento.
 */
export default function TransportRequestCard({ slug, business, kind, bookingRef, serviceName, whenLabel }) {
  const [state, setState] = useState({ status: 'loading' }) // loading | hidden | ready
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(null) // endereco enviado nesta sessao

  useEffect(() => {
    let active = true
    getTransportState(slug, kind, bookingRef)
      .then((data) => {
        if (!active) return
        setState(data.enabled ? { status: 'ready', requestStatus: data.request_status } : { status: 'hidden' })
      })
      .catch(() => { if (active) setState({ status: 'hidden' }) }) // recurso opcional: some se algo falhar
    return () => { active = false }
  }, [slug, kind, bookingRef])

  if (state.status !== 'ready') return null

  const generalUrl = whatsappUrl(business.contact_phone)
  const code = String(bookingRef).slice(0, 8).toUpperCase()
  const field = (name) => ({
    value: form[name],
    onChange: (event) => setForm((current) => ({ ...current, [name]: event.target.value })),
  })
  const valid = form.street.trim().length >= 2 && form.number.trim().length >= 1 && form.neighborhood.trim().length >= 2

  async function submit(event) {
    event.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    setError('')
    const address = Object.fromEntries(Object.entries(form).map(([name, value]) => [name, value.trim()]))
    const url = customerWhatsappUrl({ businessPhone: business.contact_phone, serviceName, whenLabel, code, address })
    // A aba do WhatsApp e aberta AQUI, no clique (antes de esperar o servidor), para o navegador nao bloquear.
    // Depois que o pedido e registrado ela recebe o link com a mensagem pronta; se falhar, e fechada.
    const popup = url ? window.open('about:blank', '_blank') : null
    if (popup) { try { popup.opener = null } catch { /* sem opener: segue */ } }
    try {
      await requestTransport({ slug, kind, ref: bookingRef, address })
      setSent(address)
      if (popup) popup.location.href = url
    } catch (err) {
      if (popup) popup.close()
      setError(messageFor(err))
    } finally {
      setSubmitting(false)
    }
  }

  // Pedido enviado agora: botao do WhatsApp com a mensagem pronta (endereco organizado).
  if (sent) {
    const url = customerWhatsappUrl({ businessPhone: business.contact_phone, serviceName, whenLabel, code, address: sent })
    return (
      <section className="transport-request-card" aria-live="polite">
        <h2><span aria-hidden="true">🚗</span> Pedido de leva e traz registrado</h2>
        <p>O estabelecimento vai calcular o valor e combinar a busca com você. O WhatsApp abre com a mensagem pronta; se não abrir, toque no botão abaixo.</p>
        {url
          ? <a className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer">Consultar valor pelo WhatsApp</a>
          : <p className="muted">O estabelecimento entrará em contato para informar o valor.</p>}
      </section>
    )
  }

  // Pedido que ja existia (por exemplo, ao reabrir esta tela)
  if (state.requestStatus) {
    return (
      <section className="transport-request-card">
        <h2><span aria-hidden="true">🚗</span> Leva e traz solicitado</h2>
        <p>Seu pedido já está com o estabelecimento, que vai combinar os detalhes com você.</p>
        {generalUrl && <a className="btn btn-quiet" href={generalUrl} target="_blank" rel="noopener noreferrer">Falar pelo WhatsApp</a>}
      </section>
    )
  }

  if (!open) {
    return (
      <section className="transport-request-card">
        <h2><span aria-hidden="true">🚗</span> Precisa de leva e traz?</h2>
        <p>A gente busca o seu pet e leva de volta. Informe o endereço e consulte o valor pelo WhatsApp.</p>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)}>Solicitar leva e traz</button>
      </section>
    )
  }

  return (
    <section className="transport-request-card">
      <h2><span aria-hidden="true">🚗</span> Solicitar leva e traz</h2>
      <form className="stack-sm" onSubmit={submit}>
        <div className="transport-grid">
          <div className="field transport-wide"><label htmlFor="tr-street">Rua</label>
            <input id="tr-street" type="text" maxLength={120} autoComplete="address-line1" required {...field('street')} /></div>
          <div className="field"><label htmlFor="tr-number">Número</label>
            <input id="tr-number" type="text" maxLength={20} autoComplete="off" required {...field('number')} /></div>
          <div className="field"><label htmlFor="tr-hood">Bairro</label>
            <input id="tr-hood" type="text" maxLength={80} autoComplete="address-level3" required {...field('neighborhood')} /></div>
          <div className="field"><label htmlFor="tr-city">Cidade (opcional)</label>
            <input id="tr-city" type="text" maxLength={80} autoComplete="address-level2" {...field('city')} /></div>
          <div className="field"><label htmlFor="tr-compl">Complemento (opcional)</label>
            <input id="tr-compl" type="text" maxLength={80} autoComplete="off" {...field('complement')} /></div>
          <div className="field transport-wide"><label htmlFor="tr-ref">Ponto de referência (opcional)</label>
            <input id="tr-ref" type="text" maxLength={120} autoComplete="off" {...field('reference')} /></div>
        </div>
        <p className="hint">Usamos o endereço só para calcular o valor e combinar a busca e a entrega do seu pet.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="transport-actions">
          <button type="submit" className="btn btn-primary" disabled={!valid || submitting}>
            {submitting ? 'Enviando…' : 'Consultar valor'}
          </button>
          <button type="button" className="btn-text" onClick={() => setOpen(false)} disabled={submitting}>Voltar</button>
        </div>
      </form>
    </section>
  )
}

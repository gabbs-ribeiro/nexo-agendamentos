import { useState } from 'react'
import Notice from '../../components/Notice.jsx'
import { publicBookingUrl } from './publicBookingUrl.js'

export default function BookingShareCard({ slug, businessName }) {
  const [feedback, setFeedback] = useState('')
  const url = publicBookingUrl(window.location.origin, slug)

  async function copyLink() {
    setFeedback('')
    try {
      await navigator.clipboard.writeText(url)
      setFeedback('Link copiado. Envie para seus clientes.')
    } catch {
      setFeedback('Não foi possível copiar automaticamente. Selecione o link para copiá-lo.')
    }
  }

  async function shareLink() {
    setFeedback('')
    if (navigator.share) {
      try {
        await navigator.share({ title: `Agende com ${businessName}`, text: `Agende seu atendimento com ${businessName}.`, url })
        setFeedback('Link compartilhado.')
      } catch (error) {
        if (error.name !== 'AbortError') setFeedback('Não foi possível abrir o compartilhamento neste dispositivo.')
      }
      return
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(`Agende seu atendimento com ${businessName}: ${url}`)}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="booking-share-card stack-sm" aria-labelledby="booking-share-title">
      <div>
        <p className="eyebrow">Divulgue seu atendimento</p>
        <h2 id="booking-share-title">Compartilhe seu link de agendamento</h2>
        <p className="muted">Envie para seus clientes escolherem o serviço e horário.</p>
      </div>
      <label className="sr-only" htmlFor="public-booking-link">Link para agendamento do cliente</label>
      <input id="public-booking-link" className="share-link-input" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
      <div className="share-actions">
        <button type="button" className="btn btn-primary" onClick={copyLink}>Copiar link</button>
        <button type="button" className="btn btn-quiet" onClick={shareLink}>Compartilhar</button>
      </div>
      {feedback && <p className="small" role="status">{feedback}</p>}
    </section>
  )
}

import { Link, Navigate, useLocation } from 'react-router-dom'
import { formatBRL, formatLongDate, whatsappUrl } from '../../lib/format.js'
import { nightsLabel } from './stayDates.js'
import { usePublic } from './usePublic.js'

const storeKey = (slug) => `nexo:last-stay:${slug}`

// Guarda SO a resposta do servidor (sem nome/telefone) para a pagina sobreviver a um refresh.
export function saveStayConfirmation(slug, stay) {
  try { sessionStorage.setItem(storeKey(slug), JSON.stringify(stay)) } catch { /* sem storage: segue so com location.state */ }
}
function readStayConfirmation(slug) {
  try { return JSON.parse(sessionStorage.getItem(storeKey(slug))) } catch { return null }
}

export default function StayConfirmedPage() {
  const { slug, business } = usePublic()
  const location = useLocation()
  const stay = location.state?.stay ?? readStayConfirmation(slug)
  if (!stay) return <Navigate to={`/${slug}`} replace />

  const wa = whatsappUrl(business.contact_phone)

  return (
    <div className="confirmation-page stack">
      <section className="confirmation-welcome">
        <span className="confirmation-mark" aria-hidden="true">✓</span>
        <p className="eyebrow">Tudo certo!</p>
        <h1>Hospedagem reservada.</h1>
        <p>A estadia do seu pet está reservada. Confira os detalhes abaixo.</p>
      </section>
      <article className="ticket" aria-labelledby="stay-ticket-title">
        <div className="ticket-head">
          <h2 id="stay-ticket-title">Hospedagem</h2>
          <p>{business.name}</p>
        </div>
        <div className="ticket-body">
          <dl>
            <dt>Entrada</dt><dd>{formatLongDate(stay.check_in)}</dd>
            <dt>Saída</dt><dd>{formatLongDate(stay.check_out)}</dd>
          </dl>
        </div>
        <div className="ticket-tear" aria-hidden="true" />
        <div className="ticket-body">
          <dl>
            <dt>Serviço</dt><dd>{stay.service_name}</dd>
            <dt>Porte</dt><dd>{stay.size_label}</dd>
            <dt>Diárias</dt><dd>{nightsLabel(stay.nights)} × {formatBRL(stay.daily_price_cents)}</dd>
            <dt>Valor total</dt><dd>{formatBRL(stay.total_price_cents)}</dd>
            <dt>Código</dt><dd className="ref">{String(stay.booking_ref).slice(0, 8).toUpperCase()}</dd>
          </dl>
        </div>
      </article>

      <p className="muted">
        Guarde esta tela. Para alterar ou cancelar, entre em contato com o estabelecimento
        {wa ? <> pelo <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></> : null}.
      </p>

      <Link className="btn btn-quiet" to={`/${slug}`}>Voltar ao início</Link>
    </div>
  )
}

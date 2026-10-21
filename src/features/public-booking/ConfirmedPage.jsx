import { Link, Navigate, useLocation } from 'react-router-dom'
import { SIZE_LABELS, formatBRL, formatDuration, formatInstant, whatsappUrl } from '../../lib/format.js'
import { usePublic } from './usePublic.js'

const storeKey = (slug) => `nexo:last-booking:${slug}`

// Guarda SO a resposta do servidor (sem nome/telefone) para a pagina sobreviver a um refresh.
export function saveConfirmation(slug, booking) {
  try { sessionStorage.setItem(storeKey(slug), JSON.stringify(booking)) } catch { /* sem storage: segue so com location.state */ }
}
function readConfirmation(slug) {
  try { return JSON.parse(sessionStorage.getItem(storeKey(slug))) } catch { return null }
}

export default function ConfirmedPage() {
  const { slug, business } = usePublic()
  const location = useLocation()
  const booking = location.state?.booking ?? readConfirmation(slug)
  if (!booking) return <Navigate to={`/${slug}`} replace />

  const { date, time } = formatInstant(booking.starts_at, booking.timezone)
  const minutes = Math.round((new Date(booking.ends_at) - new Date(booking.starts_at)) / 60000)
  const wa = whatsappUrl(business.contact_phone)

  return (
    <div className="confirmation-page stack">
      <section className="confirmation-welcome">
        <span className="confirmation-mark" aria-hidden="true">✓</span>
        <p className="eyebrow">Tudo certo!</p>
        <h1>Obrigado por agendar com a gente.</h1>
        <p>O atendimento do seu pet está marcado. Confira os detalhes abaixo.</p>
      </section>
      <article className="ticket" aria-labelledby="ticket-title">
        <div className="ticket-head">
          <h2 id="ticket-title">Serviço agendado</h2>
          <p>{business.name}</p>
        </div>
        <div className="ticket-body">
          <p>{date}</p>
          <p className="ticket-time">{time}</p>
        </div>
        <div className="ticket-tear" aria-hidden="true" />
        <div className="ticket-body">
          <dl>
            <dt>Serviço</dt><dd>{booking.service_name}</dd>
            <dt>Porte</dt><dd>{booking.size_label || SIZE_LABELS[booking.size] || booking.size}</dd>
            <dt>Duração</dt><dd>{formatDuration(minutes)}</dd>
            <dt>Valor</dt><dd>{formatBRL(booking.price_cents)}</dd>
            <dt>Código</dt><dd className="ref">{String(booking.booking_ref).slice(0, 8).toUpperCase()}</dd>
          </dl>
        </div>
      </article>

      <p className="muted">
        Guarde esta tela. Para remarcar ou cancelar, entre em contato com o estabelecimento
        {wa ? <> pelo <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></> : null}.
      </p>

      <Link className="btn btn-quiet" to={`/${slug}`}>Voltar ao início</Link>
    </div>
  )
}

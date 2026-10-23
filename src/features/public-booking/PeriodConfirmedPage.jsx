import { Link, Navigate, useLocation } from 'react-router-dom'
import { formatBRL, formatLongDate, whatsappUrl } from '../../lib/format.js'
import { usePublic } from './usePublic.js'

const storeKey = (slug) => `nexo:last-period:${slug}`
const periodLabels = { morning: 'Manhã', afternoon: 'Tarde', full_day: 'Integral' }

function readConfirmation(slug) {
  try { return JSON.parse(sessionStorage.getItem(storeKey(slug))) } catch { return null }
}

export default function PeriodConfirmedPage() {
  const { slug, business } = usePublic()
  const location = useLocation()
  const booking = location.state?.booking ?? readConfirmation(slug)
  if (!booking) return <Navigate to={`/${slug}`} replace />
  const wa = whatsappUrl(business.contact_phone)

  return (
    <div className="confirmation-page stack">
      <section className="confirmation-welcome">
        <span className="confirmation-mark" aria-hidden="true">✓</span>
        <p className="eyebrow">Tudo certo!</p>
        <h1>Período reservado.</h1>
        <p>A vaga da creche para o seu pet foi reservada.</p>
      </section>
      <article className="ticket" aria-labelledby="period-ticket-title">
        <div className="ticket-head">
          <h2 id="period-ticket-title">{periodLabels[booking.period] ?? 'Creche'}</h2>
          <p>{business.name}</p>
        </div>
        <div className="ticket-body">
          <dl>
            <dt>Data</dt><dd>{formatLongDate(booking.date)}</dd>
            <dt>Horário</dt><dd>{booking.local_start}–{booking.local_end}</dd>
            <dt>Serviço</dt><dd>{booking.service_name}</dd>
            <dt>Porte</dt><dd>{booking.size_label}</dd>
            <dt>Valor</dt><dd>{formatBRL(booking.price_cents)}</dd>
            <dt>Código</dt><dd className="ref">{String(booking.booking_ref).slice(0, 8).toUpperCase()}</dd>
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

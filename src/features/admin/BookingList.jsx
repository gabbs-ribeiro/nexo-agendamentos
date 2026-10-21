import { Link } from 'react-router-dom'
import { formatBRL, formatInstant } from '../../lib/format.js'

export default function BookingList({ bookings, timezone, emptyText = 'Nenhum agendamento ativo para este dia.' }) {
  if (bookings.length === 0) {
    return <p className="agenda-empty">{emptyText}</p>
  }

  return (
    <ol className="booking-timeline">
      {bookings.map((booking) => {
        const time = formatInstant(booking.starts_at, timezone).time
        const end = formatInstant(booking.ends_at, timezone).time
        return (
          <li key={booking.id} className="booking-timeline-item">
            <div className="timeline-time">
              <time dateTime={booking.starts_at}>{time}</time>
              <span>{end}</span>
            </div>
            <Link className="booking-card-link" to={`/admin/agendamentos/${booking.id}`}>
              <div className="booking-card-heading">
                <div>
                  <strong>{booking.pet_name}</strong>
                  <span>{booking.service_name} · {booking.customer_name}</span>
                </div>
                <span className="booking-list-price">{formatBRL(booking.price_cents)}</span>
              </div>
              {booking.size_label && <span className="booking-size">{booking.size_label}</span>}
              {booking.notes && (
                <p className="booking-customer-note">
                  <strong>Observação do cliente</strong>
                  <span>{booking.notes}</span>
                </p>
              )}
              {booking.internal_notes && (
                <p className="booking-internal-note">
                  <strong>Anotação interna</strong>
                  <span>{booking.internal_notes}</span>
                </p>
              )}
            </Link>
          </li>
        )
      })}
    </ol>
  )
}

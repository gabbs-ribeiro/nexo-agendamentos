import { Link } from 'react-router-dom'
import { formatInstant } from '../../lib/format.js'

export default function BookingList({ bookings, timezone }) {
  if (bookings.length === 0) {
    return <p className="muted">Nenhum agendamento ativo para este dia.</p>
  }

  return (
    <ul className="booking-list">
      {bookings.map((booking) => {
        const time = formatInstant(booking.starts_at, timezone).time
        const end = formatInstant(booking.ends_at, timezone).time
        return (
          <li key={booking.id}>
            <Link className="booking-list-link" to={`/admin/agendamentos/${booking.id}`}>
              <time className="booking-list-time">{time}–{end}</time>
              <span className="booking-list-main">
                <strong>{booking.pet_name}</strong>
                <span>{booking.service_name} · {booking.customer_name}</span>
              </span>
              <span className="booking-list-price">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(booking.price_cents / 100)}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

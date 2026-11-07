import { Link } from 'react-router-dom'
import { formatBRL, formatInstant, shortCode } from '../../lib/format.js'
import TransportBadge from '../transport/TransportBadge.jsx'
import { totalWithTransport } from '../transport/transportCalc.js'
import { useTransportRequests } from '../transport/useTransport.js'
import { canCompleteBooking } from './bookingView.js'

export default function BookingList({
  bookings,
  timezone,
  emptyText = 'Nenhum agendamento ativo para este dia.',
  now,
  completingBookingId,
  onComplete,
}) {
  const transport = useTransportRequests('booking', bookings.map((booking) => booking.id))

  if (bookings.length === 0) {
    return <p className="agenda-empty">{emptyText}</p>
  }

  return (
    <ol className="booking-timeline">
      {bookings.map((booking) => {
        const time = formatInstant(booking.starts_at, timezone).time
        const end = formatInstant(booking.ends_at, timezone).time
        return (
          <li key={booking.id} className="booking-timeline-item" data-status={booking.status}>
            <div className="timeline-time">
              <time dateTime={booking.starts_at}>{time}</time>
              <span>{end}</span>
            </div>
            <div className="booking-timeline-content">
              <Link className="booking-card-link" to={`/admin/agendamentos/${booking.id}`}>
                <div className="booking-card-heading">
                  <div>
                    <strong>{booking.pet_name}</strong>
                    {booking.pet_breed && <span className="pet-breed">{booking.pet_breed}</span>}
                    <span>{booking.service_name} · {booking.customer_name}</span>
                  </div>
                  <span className="booking-list-price">{formatBRL(totalWithTransport(booking.price_cents, transport.map[booking.id]))}</span>
                </div>
                <span className={`booking-status ${booking.status === 'completed' ? 'booking-status-completed' : 'booking-status-pending'}`}>
                  {booking.status === 'completed' ? 'Concluído' : 'Pendente'}
                </span>
                {booking.size_label && <span className="booking-size-pill">Porte {booking.size_label}</span>}
                <TransportBadge request={transport.map[booking.id]} />
                <span className="booking-code">Cód. <code>{shortCode(booking.id)}</code></span>
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
              {canCompleteBooking(booking, now) && (
                <button
                  type="button"
                  className="booking-complete-button"
                  onClick={() => onComplete(booking)}
                  disabled={Boolean(completingBookingId)}
                >
                  {completingBookingId === booking.id ? 'Concluindo…' : 'Concluir agendamento'}
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

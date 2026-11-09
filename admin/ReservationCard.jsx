import { Link } from 'react-router-dom'
import PhoneWhatsApp from '../../components/PhoneWhatsApp.jsx'
import { formatBRL } from '../../lib/format.js'
import TransportBadge from '../transport/TransportBadge.jsx'
import { totalWithTransport } from '../transport/transportCalc.js'

const STATUS = {
  confirmed: ['Pendente', 'booking-status-pending'],
  completed: ['Concluído', 'booking-status-completed'],
  cancelled: ['Cancelado', 'booking-status-cancelled'],
}

/** Cartao unico para qualquer reserva (horario, hospedagem ou creche) na visao geral e na busca. */
export default function ReservationCard({ reservation, request, onPickDate }) {
  const [statusLabel, statusClass] = STATUS[reservation.status] ?? [reservation.status, 'booking-status-pending']
  return (
    <li className="reservation-card" data-status={reservation.status} data-kind={reservation.kind}>
      <div className="reservation-card-head">
        <div className="reservation-card-pet">
          <strong>{reservation.petName}</strong>
          {reservation.petBreed && <span className="pet-breed">{reservation.petBreed}</span>}
        </div>
        <span className="booking-list-price">{formatBRL(totalWithTransport(reservation.baseCents, request))}</span>
      </div>
      <p className="reservation-card-service">{reservation.serviceName} · {reservation.customerName}</p>
      <div className="reservation-card-tags">
        {reservation.sizeLabel && <span className="booking-size-pill">Porte {reservation.sizeLabel}</span>}
        <span className={`booking-status ${statusClass}`}>{statusLabel}</span>
        <TransportBadge request={request} />
      </div>
      <p className="reservation-card-when">{reservation.whenLabel}</p>
      <p className="reservation-card-meta">
        <PhoneWhatsApp phone={reservation.customerPhone} />
        <span className="booking-code">Cód. <code>{reservation.code}</code></span>
      </p>
      {reservation.notes && (
        <p className="booking-customer-note"><strong>Observação do cliente</strong><span>{reservation.notes}</span></p>
      )}
      <div className="reservation-card-actions">
        {reservation.kind === 'booking' && (
          <Link className="btn btn-quiet" to={`/admin/agendamentos/${reservation.id}`}>Abrir agendamento</Link>
        )}
        {onPickDate && (
          <button type="button" className="btn-text" onClick={() => onPickDate(reservation.ymd)}>Ver no calendário</button>
        )}
      </div>
    </li>
  )
}

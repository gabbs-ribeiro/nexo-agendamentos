import { SIZE_LABELS, formatBRL, formatDuration, formatInstant } from '../../lib/format.js'

export default function SummaryBar({ selected, slot, timezone }) {
  const { service, option } = selected
  const when = slot ? formatInstant(slot.starts_at, timezone) : null
  const size = (option.size_label || SIZE_LABELS[option.size] || option.size).toLowerCase()
  return (
    <div className="summary">
      <span className="summary-icon" aria-hidden="true">🐾</span>
      <div className="summary-body">
        <p className="summary-title"><strong>{service.name}</strong><span className="summary-size">porte {size}</span></p>
        <p className="summary-meta"><span>{formatDuration(option.duration_minutes)}</span><span className="summary-price">{formatBRL(option.price_cents)}</span></p>
        {when && <p className="summary-when">{when.date}, às {when.time}</p>}
      </div>
    </div>
  )
}

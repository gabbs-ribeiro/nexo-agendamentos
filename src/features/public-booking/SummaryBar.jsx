import { SIZE_LABELS, formatBRL, formatDuration, formatInstant } from '../../lib/format.js'

export default function SummaryBar({ selected, slot, timezone }) {
  const { service, option } = selected
  const when = slot ? formatInstant(slot.starts_at, timezone) : null
  return (
    <div className="summary">
      <p><strong>{service.name}</strong>, porte {SIZE_LABELS[option.size].toLowerCase()}</p>
      <p className="muted small">{formatDuration(option.duration_minutes)}, {formatBRL(option.price_cents)}</p>
      {when && <p className="small">{when.date}, às {when.time}</p>}
    </div>
  )
}

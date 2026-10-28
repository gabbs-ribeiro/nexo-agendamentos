// Resumo comum das reservas (qualquer tipo) para a calculadora e a caixa de pedidos.
import { formatInstant } from '../../lib/format.js'
import { formatShortDate } from '../public-booking/stayDates.js'

export const PERIOD_LABELS = { morning: 'Manhã', afternoon: 'Tarde', full_day: 'Integral' }

const base = (row, whenLabel, baseCents) => ({
  id: row.id,
  status: row.status,
  customer_name: row.customer_name,
  customer_phone: row.customer_phone,
  pet_name: row.pet_name,
  service_name: row.service_name,
  whenLabel,
  baseCents,
})

export function bookingSummary(booking, timezone) {
  const { date, time } = formatInstant(booking.starts_at, timezone)
  return base(booking, `${date} às ${time}`, booking.price_cents)
}

export function staySummary(stay, timezone) {
  const whenLabel = stay.check_in_at
    ? `${formatInstant(stay.check_in_at, timezone).date} ${formatInstant(stay.check_in_at, timezone).time} → ${formatInstant(stay.check_out_at, timezone).date} ${formatInstant(stay.check_out_at, timezone).time}`
    : `${formatShortDate(stay.check_in)} → ${formatShortDate(stay.check_out)}`
  return base(stay, whenLabel, stay.total_price_cents)
}

export function daycareSummary(booking, timezone) {
  const { date } = formatInstant(booking.starts_at, timezone)
  return base(booking, `${date} (${PERIOD_LABELS[booking.period] ?? 'Creche'})`, booking.price_cents)
}

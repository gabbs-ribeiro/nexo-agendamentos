import { SIZE_LABELS, formatBRL, formatDuration, formatInstant, formatLongDate } from '../../lib/format.js'

const dateFormatter = (timezone) => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function dateInTimezone(instant, timezone) {
  const parts = dateFormatter(timezone).formatToParts(new Date(instant))
  const part = (type) => parts.find((value) => value.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function zonedMidnight(date, timezone) {
  const [year, month, day] = date.split('-').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcGuess))
  const part = (type) => Number(parts.find((value) => value.type === type).value)
  const localAsUtc = Date.UTC(
    part('year'), part('month') - 1, part('day'),
    part('hour'), part('minute'), part('second'),
  )
  return new Date(utcGuess - (localAsUtc - utcGuess)).toISOString()
}

export function dateRangeInTimezone(date, timezone) {
  const [year, month, day] = date.split('-').map(Number)
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  return {
    start: zonedMidnight(date, timezone),
    end: zonedMidnight(nextDay, timezone),
  }
}

export function bookingDetails(booking, timezone) {
  return {
    service: booking.service_name,
    size: booking.size_label || SIZE_LABELS[booking.size] || booking.size,
    date: formatLongDate(dateInTimezone(booking.starts_at, timezone)),
    start: formatInstant(booking.starts_at, timezone).time,
    end: formatInstant(booking.ends_at, timezone).time,
    duration: formatDuration(booking.duration_minutes),
    price: formatBRL(booking.price_cents),
    status: {
      confirmed: 'Confirmado',
      cancelled: 'Cancelado',
      completed: 'Concluído',
      no_show: 'Não compareceu',
    }[booking.status] ?? booking.status,
  }
}

export function canCancelBooking(status) {
  return status === 'confirmed'
}

export function canCompleteBooking(booking, now = Date.now()) {
  return booking.status === 'confirmed' && Date.parse(booking.ends_at) <= now
}

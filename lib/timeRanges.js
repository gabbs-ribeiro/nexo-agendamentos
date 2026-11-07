export function parseTimeRange(start, end) {
  const normalize = (value) => typeof value === 'string'
    && /^([01]\d|2[0-3]):[0-5]\d(?::00(?:\.0+)?)?$/.test(value)
    ? value.slice(0, 5)
    : null
  const normalizedStart = normalize(start)
  const normalizedEnd = normalize(end)
  if (!normalizedStart || !normalizedEnd || normalizedStart > normalizedEnd) return null
  return { start: normalizedStart, end: normalizedEnd }
}

export function timeOptionsInRange(start, end) {
  const range = parseTimeRange(start, end)
  if (!range) return []
  const startMinutes = Number(range.start.slice(0, 2)) * 60 + Number(range.start.slice(3))
  const endMinutes = Number(range.end.slice(0, 2)) * 60 + Number(range.end.slice(3))
  const options = []
  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 30) {
    options.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`)
  }
  return options
}

/** Minutos desde 00:00 AGORA no fuso do negocio (para esconder horarios de hoje que ja passaram). */
export function minutesNowInTz(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** "HH:MM" -> minutos desde 00:00. */
export function timeToMinutes(hhmm) {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
}

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

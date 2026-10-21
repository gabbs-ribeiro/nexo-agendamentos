export const WEEKDAYS = [
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
]

export function timeForMinute(minute) {
  if (minute === 1440) return '24:00'
  const hours = Math.floor(minute / 60)
  const minutes = minute % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function businessHoursDraft(rows) {
  return Object.fromEntries(WEEKDAYS.map(({ value }) => [
    value,
    rows.filter((row) => row.day_of_week === value).map((row) => ({
      id: row.id,
      opens_at: timeForMinute(row.opens_minute),
      closes_at: row.closes_minute === 1440 ? '00:00' : timeForMinute(row.closes_minute),
    })),
  ]))
}

function minuteFromTime(value, allowMidnight) {
  if (allowMidnight && value === '24:00') return 1440
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function businessHoursPayload(draft) {
  const intervals = []
  for (const { value: dayOfWeek } of WEEKDAYS) {
    const dayIntervals = (draft[dayOfWeek] ?? []).map((interval) => {
      const opensMinute = minuteFromTime(interval.opens_at, false)
      const selectedCloseMinute = minuteFromTime(interval.closes_at, false)
      const closesMinute = selectedCloseMinute === 0 && opensMinute !== 0 ? 1440 : selectedCloseMinute
      if (opensMinute === null || closesMinute === null || closesMinute <= opensMinute) {
        throw new Error('INVALID_HOURS')
      }
      return { day_of_week: dayOfWeek, opens_minute: opensMinute, closes_minute: closesMinute }
    }).sort((first, second) => first.opens_minute - second.opens_minute)

    for (let index = 1; index < dayIntervals.length; index += 1) {
      if (dayIntervals[index].opens_minute < dayIntervals[index - 1].closes_minute) {
        throw new Error('INVALID_HOURS')
      }
    }
    intervals.push(...dayIntervals)
  }
  return intervals
}

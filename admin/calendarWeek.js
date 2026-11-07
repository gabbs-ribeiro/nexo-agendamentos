import { addDaysYmd } from '../../lib/format.js'

const noon = (ymd) => new Date(`${ymd}T12:00:00Z`)
const fmt = (ymd, opts) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...opts }).format(noon(ymd))
const weekdayIndex = (ymd) => noon(ymd).getUTCDay() // 0 = domingo

export const capitalizeFirst = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)

// Semana de segunda a domingo que contém a data (AAAA-MM-DD).
export function weekStartYmd(ymd) {
  return addDaysYmd(ymd, -((weekdayIndex(ymd) + 6) % 7))
}
export function weekDays(ymd) {
  const start = weekStartYmd(ymd)
  return Array.from({ length: 7 }, (_, index) => addDaysYmd(start, index))
}

// "Outubro de 2026" ou, quando a semana vira o mês, "Outubro / Novembro de 2026".
export function weekMonthTitle(days) {
  const first = days[0]
  const last = days[days.length - 1]
  const monthA = capitalizeFirst(fmt(first, { month: 'long' }))
  const monthB = capitalizeFirst(fmt(last, { month: 'long' }))
  const yearA = fmt(first, { year: 'numeric' })
  const yearB = fmt(last, { year: 'numeric' })
  if (monthA === monthB) return `${monthA} de ${yearA}`
  if (yearA === yearB) return `${monthA} / ${monthB} de ${yearA}`
  return `${monthA} ${yearA} / ${monthB} ${yearB}`
}

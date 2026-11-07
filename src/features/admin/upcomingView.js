// Visao geral das reservas marcadas (funcoes puras).
import { todayInTz, formatInstant, formatLongDate, shortCode } from '../../lib/format.js'
import { PERIOD_LABELS } from '../transport/reservationSummary.js'
import { formatShortDate } from '../public-booking/stayDates.js'

export const KIND_LABELS = {
  booking: 'Banho e tosa e serviços por horário',
  stay: 'Hospedagem',
  daycare: 'Creche por período',
}
export const KIND_ORDER = ['booking', 'stay', 'daycare']

/** Normaliza um item vindo de qualquer tabela para o formato unico dos cartoes. */
export function normalizeReservation(kind, row, timezone) {
  const startIso = kind === 'stay' ? (row.check_in_at ?? null) : row.starts_at
  const ymd = kind === 'stay' ? row.check_in : todayInTz(timezone, new Date(row.starts_at))
  const priceCents = kind === 'stay' ? row.total_price_cents : row.price_cents
  return {
    kind,
    id: row.id,
    status: row.status,
    ymd,
    startIso,
    code: shortCode(row.id),
    petName: row.pet_name,
    petBreed: row.pet_breed ?? '',
    serviceName: row.service_name,
    sizeLabel: row.size_label ?? '',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    notes: row.notes ?? '',
    internalNotes: row.internal_notes ?? '',
    baseCents: priceCents,
    whenLabel: whenLabel(kind, row, timezone),
  }
}

/** "08:00–10:00" | "Manhã · 07:00–12:00" | "25/10 08:00 → 27/10 20:00". */
export function whenLabel(kind, row, timezone) {
  if (kind === 'booking') {
    return `${formatInstant(row.starts_at, timezone).time}–${formatInstant(row.ends_at, timezone).time}`
  }
  if (kind === 'daycare') {
    return `${PERIOD_LABELS[row.period] ?? 'Creche'} · ${formatInstant(row.starts_at, timezone).time}–${formatInstant(row.ends_at, timezone).time}`
  }
  if (row.check_in_at && row.check_out_at) {
    const a = formatInstant(row.check_in_at, timezone)
    const b = formatInstant(row.check_out_at, timezone)
    return `${formatShortDate(row.check_in)} ${a.time} → ${formatShortDate(row.check_out)} ${b.time}`
  }
  return `${formatShortDate(row.check_in)} → ${formatShortDate(row.check_out)}`
}

/** [[ymd, itens[]], ...] ordenado por data (e por horario dentro do dia). */
export function groupByDate(items) {
  const groups = new Map()
  for (const item of items) {
    if (!groups.has(item.ymd)) groups.set(item.ymd, [])
    groups.get(item.ymd).push(item)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ymd, list]) => [ymd, list.slice().sort((a, b) => String(a.startIso).localeCompare(String(b.startIso)))])
}

/** "Hoje · Quinta-feira, 29 de outubro" | "Amanhã · ..." | "Segunda-feira, 2 de novembro". */
export function dateHeading(ymd, todayYmd) {
  const long = formatLongDate(ymd)
  const label = long.charAt(0).toUpperCase() + long.slice(1)
  if (ymd === todayYmd) return `Hoje · ${label}`
  const tomorrow = new Date(`${todayYmd}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  if (ymd === tomorrow.toISOString().slice(0, 10)) return `Amanhã · ${label}`
  return label
}

/** Texto digitado -> so hexadecimais em minusculas (o banco faz o mesmo). */
export function normalizeCode(text) {
  return String(text ?? '').replace(/[^0-9a-fA-F]/g, '').toLowerCase()
}

export const MIN_CODE_LENGTH = 4

/** Filtra itens ja carregados pelo codigo (busca instantanea, sem ir ao banco). */
export function filterByCode(items, text) {
  const code = normalizeCode(text)
  if (code.length < MIN_CODE_LENGTH) return []
  return items.filter((item) => item.id.replace(/-/g, '').startsWith(code))
}

/** Item devolvido pela busca por codigo (qualquer data): sempre mostra a data. */
export function normalizeFound(row, timezone) {
  const ymd = todayInTz(timezone, new Date(row.starts_at))
  const day = formatShortDate(ymd)
  const start = formatInstant(row.starts_at, timezone).time
  const end = formatInstant(row.ends_at, timezone).time
  let label
  if (row.kind === 'stay') {
    const endDay = formatShortDate(todayInTz(timezone, new Date(row.ends_at)))
    label = `${day} ${start} → ${endDay} ${end}`
  } else {
    label = `${day} · ${start}–${end}`
  }
  return {
    kind: row.kind,
    id: row.id,
    status: row.status,
    ymd,
    startIso: row.starts_at,
    code: shortCode(row.id),
    petName: row.pet_name,
    petBreed: row.pet_breed ?? '',
    serviceName: row.service_name,
    sizeLabel: row.size_label ?? '',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    notes: '',
    internalNotes: '',
    baseCents: row.price_cents,
    whenLabel: label,
  }
}

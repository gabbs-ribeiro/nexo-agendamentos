export function priceToCents(value) {
  const normalized = String(value).trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount > 21474836.47) return null
  return Math.round(amount * 100)
}

export function sizeCodeForName(name, suffix = globalThis.crypto.randomUUID()) {
  const base = name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${base || 'porte'}-${suffix.replace(/-/g, '').slice(0, 12).toLowerCase()}`
}

export const BOOKING_MODE_LABELS = {
  hourly: 'Por horário',
  periods: 'Por período',
  stay: 'Entrada e saída',
  daily: 'Por diária (legado)',
}

export const DEFAULT_DURATION_MINUTES = 30

// Qualquer valor desconhecido (inclusive servicos antigos sem a coluna) vale como "por horario".
export function normalizeBookingMode(value) {
  return ['daily', 'periods', 'stay'].includes(value) ? value : 'hourly'
}

export function isDailyService(service) {
  return ['daily', 'stay'].includes(normalizeBookingMode(service?.booking_mode))
}

// Duracao que vai para o banco. Por horario: obrigatoria (5 a 720 min), senao null.
// Por diaria: a duracao nao e usada, mas a constraint do banco a exige; aproveita a atual ou usa 30.
export function resolveDurationMinutes(mode, value) {
  const duration = Number(value)
  if (value !== '' && Number.isInteger(duration) && duration >= 5 && duration <= 720) return duration
  return ['daily', 'periods', 'stay'].includes(normalizeBookingMode(mode))
    ? DEFAULT_DURATION_MINUTES
    : null
}

export function parseTimeOptions(value) {
  const values = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  if (!values.length || values.some((item) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(item))) return null
  const unique = [...new Set(values)]
  return unique.length === values.length ? unique.sort() : null
}

export function isValidPeriodSettings(settings) {
  const { morning_start, morning_end, afternoon_start, afternoon_end } = settings ?? {}
  return [morning_start, morning_end, afternoon_start, afternoon_end]
    .every((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? ''))
    && morning_start < morning_end
    && afternoon_start < afternoon_end
    && morning_end <= afternoon_start
}

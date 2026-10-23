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

export const BOOKING_MODE_LABELS = { hourly: 'Por horário', daily: 'Por diária' }

export const DEFAULT_DURATION_MINUTES = 30

// Qualquer valor desconhecido (inclusive servicos antigos sem a coluna) vale como "por horario".
export function normalizeBookingMode(value) {
  return value === 'daily' ? 'daily' : 'hourly'
}

export function isDailyService(service) {
  return normalizeBookingMode(service?.booking_mode) === 'daily'
}

// Duracao que vai para o banco. Por horario: obrigatoria (5 a 720 min), senao null.
// Por diaria: a duracao nao e usada, mas a constraint do banco a exige; aproveita a atual ou usa 30.
export function resolveDurationMinutes(mode, value) {
  const duration = Number(value)
  if (value !== '' && Number.isInteger(duration) && duration >= 5 && duration <= 720) return duration
  return normalizeBookingMode(mode) === 'daily' ? DEFAULT_DURATION_MINUTES : null
}

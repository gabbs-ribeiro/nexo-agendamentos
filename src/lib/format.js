// Funcoes puras (sem React, sem Supabase): faceis de testar.
// REGRA: datas de agenda sao sempre interpretadas no FUSO DO NEGOCIO, nunca no do navegador.

export const SIZE_LABELS = { small: 'Pequeno', medium: 'Médio', large: 'Grande' }
export const DEFAULT_BRAND = '#2563eb'

export function formatBRL(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export function formatDuration(min) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** "YYYY-MM-DD" de hoje no fuso informado. */
export function todayInTz(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Soma dias a uma data "YYYY-MM-DD" (calendario puro, sem fuso). */
export function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Lista de datas oferecidas: hoje ate hoje + maxDaysAhead (limite do negocio). */
export function bookableDays(tz, maxDaysAhead, now = new Date()) {
  const start = todayInTz(tz, now)
  return Array.from({ length: maxDaysAhead + 1 }, (_, i) => addDaysYmd(start, i))
}

const noon = (ymd) => new Date(`${ymd}T12:00:00Z`) // meio-dia UTC: nunca cruza o dia ao formatar em UTC
const stripDot = (s) => s.replace('.', '')

export function dayChipParts(ymd) {
  const d = noon(ymd)
  const f = (opts) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...opts }).format(d)
  return { weekday: stripDot(f({ weekday: 'short' })), day: f({ day: 'numeric' }), month: stripDot(f({ month: 'short' })) }
}

export function formatLongDate(ymd) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(noon(ymd))
}

/** Instante (ISO) -> data e hora como o NEGOCIO as ve. */
export function formatInstant(iso, tz) {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d)
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return { date, time }
}

// ---- telefone -----------------------------------------------------------
export const digitsOnly = (s) => (s || '').replace(/\D/g, '')

/** Remove o 55 do pais (so quando o total tem 12 ou 13 digitos), como o banco faz. */
export function nationalDigits(value) {
  const d = digitsOnly(value)
  return /^55\d{10,11}$/.test(d) ? d.slice(2) : d
}

export function maskPhone(value) {
  const d = nationalDigits(value).slice(0, 11)
  if (!d) return ''
  if (d.length <= 2) return `(${d}`
  const ddd = d.slice(0, 2)
  const rest = d.slice(2)
  if (rest.length <= 4) return `(${ddd}) ${rest}`
  if (d.length <= 10) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
}

export const isValidPhone = (value) => /^\d{10,11}$/.test(nationalDigits(value))

// ---- cor da marca ---------------------------------------------------------
const isHex = (h) => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h)

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const brandOrDefault = (hex) => (isHex(hex) ? hex : DEFAULT_BRAND)

/** Cor de texto (clara ou escura) com melhor contraste sobre o fundo da marca. */
export function readableOn(hex) {
  const bg = brandOrDefault(hex)
  const dark = '#14201F'
  const L = luminance(bg)
  const contrastWhite = 1.05 / (L + 0.05)
  const contrastDark = (L + 0.05) / (luminance(dark) + 0.05)
  return contrastWhite >= contrastDark ? '#FFFFFF' : dark
}

export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Link do WhatsApp do estabelecimento (telefone nacional com DDD, sem +55). null se invalido. */
export function whatsappUrl(contactPhone) {
  const d = digitsOnly(contactPhone)
  return /^\d{10,11}$/.test(d) ? `https://wa.me/55${d}` : null
}

// Funcoes puras das hospedagens por diaria (sem React, sem Supabase).
// Datas sao "YYYY-MM-DD" no fuso do negocio. A noite da saida nao conta como diaria.
// O banco revalida tudo; estas regras so evitam chamadas e mensagens ruins.

export const MAX_STAY_NIGHTS = 30

const toUtc = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

const isYmd = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** Numero de diarias entre entrada e saida; 0 se faltar data ou a saida nao for depois da entrada. */
export function nightsBetween(checkIn, checkOut) {
  if (!isYmd(checkIn) || !isYmd(checkOut)) return 0
  const nights = Math.round((toUtc(checkOut) - toUtc(checkIn)) / 86_400_000)
  return nights > 0 ? nights : 0
}

export function stayTotalCents(dailyCents, nights) {
  return dailyCents * nights
}

export function nightsLabel(nights) {
  return `${nights} ${nights === 1 ? 'diária' : 'diárias'}`
}

/** "2026-10-25" -> "25/10" */
export function formatShortDate(ymd) {
  if (!isYmd(ymd)) return ''
  const [, m, d] = ymd.split('-')
  return `${d}/${m}`
}

/**
 * Valida as datas escolhidas. Devolve null se estiverem ok ou um codigo:
 * MISSING | ORDER | PAST | TOO_FAR | TOO_LONG
 */
export function validateStayDates({ checkIn, checkOut, today, maxDaysAhead, maxNights = MAX_STAY_NIGHTS, addDays }) {
  if (!isYmd(checkIn) || !isYmd(checkOut)) return 'MISSING'
  if (checkIn < today) return 'PAST'
  if (checkOut <= checkIn) return 'ORDER'
  if (checkIn > addDays(today, maxDaysAhead)) return 'TOO_FAR'
  if (nightsBetween(checkIn, checkOut) > maxNights) return 'TOO_LONG'
  return null
}

export const STAY_DATE_MESSAGES = {
  PAST: 'A entrada não pode ser em uma data que já passou.',
  ORDER: 'A saída precisa ser depois da entrada.',
  TOO_FAR: 'Essa entrada está além do prazo de reservas online. Fale com o estabelecimento.',
  TOO_LONG: `Reservas online podem ter até ${MAX_STAY_NIGHTS} diárias. Para períodos maiores, fale com o estabelecimento.`,
}

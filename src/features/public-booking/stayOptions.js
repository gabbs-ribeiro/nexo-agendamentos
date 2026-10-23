const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

export function hasNoFurtherStayOptionThatDay(options, selectedOption) {
  if (!selectedOption) return false
  const nextCheckOut = Date.parse(selectedOption.check_out_at) + TWELVE_HOURS_MS
  return !options.some((option) => option.check_out === selectedOption.check_out
    && Date.parse(option.check_out_at) === nextCheckOut)
}

// ---------------------------------------------------------------------------
// Opcoes de SAIDA exibidas ao cliente (calculo so para exibir; o banco revalida).
// A saida e sempre entrada + k blocos de 12 h. Em cada data de saida existem no maximo
// dois candidatos: o mesmo horario da entrada (k par) e 12 h antes/depois dele (k impar).
// O banco so devolve os que cabem na janela de retirada; os demais aparecem como "fora do horario".
// ---------------------------------------------------------------------------
const BLOCK_MINUTES = 12 * 60
const DAY_MINUTES = 24 * 60

export const MAX_STAY_BLOCKS = 60 // 30 dias, igual ao banco
export const MAX_STAY_DAYS = 30

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const toHhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const ymdToUtc = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Dias entre duas datas "YYYY-MM-DD" (pode ser 0 ou negativo). */
export function daysBetween(fromYmd, toYmd) {
  return Math.round((ymdToUtc(toYmd) - ymdToUtc(fromYmd)) / 86_400_000)
}

/**
 * Candidatos de saida em `exitDate` para a entrada `checkIn` + `entryTime` ("HH:MM").
 * `options`: lista devolvida por get_timed_stay_options (pode ser vazia).
 * Cada item: { key, time, hours, units, relation: 'same' | 'after' | 'before', option | null }.
 */
export function exitCandidatesForDate({ checkIn, entryTime, exitDate, options = [] }) {
  if (!checkIn || !entryTime || !exitDate) return []
  const dayDiff = daysBetween(checkIn, exitDate)
  if (dayDiff < 0 || dayDiff > MAX_STAY_DAYS) return []
  const entryMinutes = toMinutes(entryTime)
  const candidates = []
  for (let block = 1; block <= MAX_STAY_BLOCKS; block += 1) {
    const total = entryMinutes + block * BLOCK_MINUTES
    if (Math.floor(total / DAY_MINUTES) !== dayDiff) continue
    const time = toHhmm(total % DAY_MINUTES)
    candidates.push({
      key: `${exitDate}|${time}`,
      time,
      hours: block * 12,
      units: block / 2,
      relation: block % 2 === 0 ? 'same' : (entryMinutes < BLOCK_MINUTES ? 'after' : 'before'),
      option: options.find((option) => option.check_out === exitDate && option.check_out_time === time) ?? null,
    })
  }
  return candidates
}

/** Datas de saida que tem ao menos um candidato (a data da entrada some quando a entrada e de tarde/noite). */
export function exitDatesFor({ checkIn, entryTime }) {
  if (!checkIn || !entryTime) return []
  const dates = []
  for (let offset = 0; offset <= MAX_STAY_DAYS; offset += 1) {
    const date = new Date(ymdToUtc(checkIn) + offset * 86_400_000).toISOString().slice(0, 10)
    if (exitCandidatesForDate({ checkIn, entryTime, exitDate: date }).length > 0) dates.push(date)
  }
  return dates
}

/** Horario fora da janela de retirada (comparacao de "HH:MM"). */
export function isOutsideWindow(time, start, end) {
  if (!start || !end) return false
  return time < start.slice(0, 5) || time > end.slice(0, 5)
}

/** 'available' | 'full' | 'outside' | 'unavailable' */
export function exitStatus(candidate, window) {
  if (candidate.option) return candidate.option.available ? 'available' : 'full'
  return isOutsideWindow(candidate.time, window?.start, window?.end) ? 'outside' : 'unavailable'
}

/** 0,5 -> "0,5 diária"; 1 -> "1 diária"; 2,5 -> "2,5 diárias". */
export function chargeUnitsLabel(units) {
  const text = String(units).replace('.', ',')
  return `${text} ${units <= 1 ? 'diária' : 'diárias'}`
}

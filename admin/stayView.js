// Apresentacao das hospedagens no painel (funcoes puras).

/** Em relacao a uma data: entrada, saida ou hospedado (datas "YYYY-MM-DD" no fuso do negocio). */
export function stayPhase(stay, date) {
  if (stay.check_in === date) return 'checkin'
  if (stay.check_out === date) return 'checkout'
  return 'staying'
}

export const STAY_PHASE_LABELS = {
  checkin: 'Entrada hoje',
  checkout: 'Saída hoje',
  staying: 'Hospedado',
}

/** Concluir so depois que chega o dia da saida (o banco tambem confere). */
export function canCompleteStay(stay, today, now = new Date()) {
  if (stay.status !== 'confirmed') return false
  return stay.check_out_at
    ? new Date(stay.check_out_at).getTime() <= now.getTime()
    : stay.check_out <= today
}

/** Pets ocupando vaga na noite da data: confirmados que entraram e ainda nao sairam. */
export function occupiedOnNight(stays, date) {
  return stays.filter((stay) => stay.status === 'confirmed'
    && stay.check_in <= date && stay.check_out > date).length
}

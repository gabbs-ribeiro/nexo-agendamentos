// Faixa de peso dos portes (funcoes puras).

const fmt = (kg) => String(Number(kg)).replace('.', ',')

/**
 * "5" | "7,5" | "7.5" -> { ok: true, value: 7.5 }; vazio -> { ok: true, value: null };
 * invalido ou fora de 0 a 999 -> { ok: false }.
 */
export function parseWeightInput(text) {
  const normalized = String(text ?? '').trim().replace(',', '.')
  if (normalized === '') return { ok: true, value: null }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { ok: false }
  const value = Math.round(Number(normalized) * 10) / 10
  return value >= 0 && value <= 999 ? { ok: true, value } : { ok: false }
}

/** Mensagem de erro para a combinacao minimo/maximo, ou '' se estiver ok. */
export function weightRangeError(min, max) {
  if (max !== null && max <= 0) return 'O peso máximo precisa ser maior que zero.'
  if (min !== null && max !== null && max < min) return 'O peso máximo não pode ser menor que o mínimo.'
  return ''
}

/** "5 a 10 kg" | "até 10 kg" | "a partir de 25 kg" | "" (sem faixa). */
export function weightRangeLabel(min, max) {
  const hasMin = min !== null && min !== undefined && min !== ''
  const hasMax = max !== null && max !== undefined && max !== ''
  if (hasMin && hasMax) return Number(min) === Number(max) ? `${fmt(min)} kg` : `${fmt(min)} a ${fmt(max)} kg`
  if (hasMax) return `até ${fmt(max)} kg`
  if (hasMin) return `a partir de ${fmt(min)} kg`
  return ''
}

/** Pares de portes ativos cujas faixas se sobrepoem (dividir no mesmo numero nao conta). */
export function findWeightOverlaps(sizes) {
  const ranges = sizes
    .filter((size) => size.is_active !== false && (size.weight_min_kg != null || size.weight_max_kg != null))
    .map((size) => ({
      name: size.name,
      min: size.weight_min_kg == null ? 0 : Number(size.weight_min_kg),
      max: size.weight_max_kg == null ? Infinity : Number(size.weight_max_kg),
    }))
  const overlaps = []
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      if (ranges[i].min < ranges[j].max && ranges[j].min < ranges[i].max) overlaps.push([ranges[i].name, ranges[j].name])
    }
  }
  return overlaps
}

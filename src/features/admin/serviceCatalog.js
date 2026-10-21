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

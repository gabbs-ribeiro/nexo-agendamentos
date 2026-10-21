import { supabase } from './supabase.js'
import { ApiError } from './errors.js'

// Toda chamada passa por aqui: erro de transporte vira ApiError('NETWORK')
// e erro de negocio ({ok:false,error}) vira ApiError(codigo). Nada bruto vaza para a tela.
async function rpc(fn, args) {
  let res
  try {
    res = await supabase.rpc(fn, args)
  } catch {
    throw new ApiError('NETWORK')
  }
  if (res.error) {
    // Falha HTTP/rede/projeto pausado/funcao inexistente: sem detalhes para o usuario.
    console.error(`[rpc ${fn}]`, res.error.code) // so o codigo; sem payload (dados pessoais)
    throw new ApiError('NETWORK')
  }
  return res.data
}

export async function getPublicBusiness(slug) {
  return rpc('get_public_business', { p_slug: slug }) // objeto ou null
}

export async function listPublicServices(slug) {
  return (await rpc('list_public_services', { p_slug: slug })) ?? []
}

export async function getAvailableSlots(slug, optionId, date) {
  return (await rpc('get_available_slots', { p_slug: slug, p_option_id: optionId, p_date: date })) ?? []
}

/**
 * Cria a reserva. `idempotencyKey` deve ser gerada UMA vez por tentativa de
 * confirmacao e reutilizada em retries (rede instavel / clique duplo).
 */
export async function createPublicBooking({ slug, optionId, startsAt, form, idempotencyKey }) {
  const data = await rpc('create_public_booking', {
    p_slug: slug,
    p_option_id: optionId,
    p_starts_at: startsAt,
    p_customer_name: form.name,
    p_customer_phone: form.phone,
    p_pet_name: form.petName,
    p_pet_breed: form.petBreed || null,
    p_notes: form.notes || null,
    p_consent: form.consent === true,
    p_idempotency_key: idempotencyKey,
  })
  if (!data || data.ok !== true) throw new ApiError(data?.error ?? 'UNKNOWN')
  return data
}

export function logoUrl(path) {
  if (!path || !supabase) return null
  return supabase.storage.from('business-logos').getPublicUrl(path).data.publicUrl
}

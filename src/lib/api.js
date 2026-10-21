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

export async function listAdminBookings(businessId, start, end) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, business_id, service_name, size, starts_at, ends_at, duration_minutes, buffer_minutes, price_cents, status, customer_name, customer_phone, pet_name, pet_breed, notes, internal_notes')
    .eq('business_id', businessId)
    .eq('status', 'confirmed')
    .gte('starts_at', start)
    .lt('starts_at', end)
    .order('starts_at', { ascending: true })

  if (error || !Array.isArray(data)) {
    if (error) console.error('[bookings select]', error.code)
    throw new ApiError('NETWORK')
  }
  return data
}

export async function getAdminBooking(businessId, bookingId) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, business_id, service_name, size, starts_at, ends_at, duration_minutes, buffer_minutes, price_cents, status, customer_name, customer_phone, pet_name, pet_breed, notes, internal_notes')
    .eq('business_id', businessId)
    .eq('id', bookingId)
    .maybeSingle()

  if (error) {
    console.error('[booking select]', error.code)
    throw new ApiError('NETWORK')
  }
  return data
}

async function adminRpc(name, args) {
  let result
  try {
    result = await supabase.rpc(name, args)
  } catch {
    throw new ApiError('NETWORK')
  }
  if (result.error) {
    console.error(`[rpc ${name}]`, result.error.code)
    throw new ApiError('NETWORK')
  }
  if (!result.data || result.data.ok !== true) {
    throw new ApiError(result.data?.error ?? 'UNKNOWN')
  }
  return result.data
}

export function updateAdminBookingDetails(booking) {
  return adminRpc('admin_update_booking_details', {
    p_booking_id: booking.id,
    p_customer_name: booking.customer_name,
    p_customer_phone: booking.customer_phone,
    p_pet_name: booking.pet_name,
    p_pet_breed: booking.pet_breed || null,
    p_notes: booking.notes || null,
  })
}

export function updateAdminBookingInternalNotes(bookingId, notes) {
  return adminRpc('admin_update_booking_internal_notes', {
    p_booking_id: bookingId,
    p_internal_notes: notes,
  })
}

export function setAdminBookingStatus(bookingId, status) {
  return adminRpc('admin_set_booking_status', {
    p_booking_id: bookingId,
    p_status: status,
  })
}

export function logoUrl(path) {
  if (!path || !supabase) return null
  return supabase.storage.from('business-logos').getPublicUrl(path).data.publicUrl
}

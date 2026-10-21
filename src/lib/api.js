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
    .select('id, business_id, service_name, size, size_label, starts_at, ends_at, duration_minutes, buffer_minutes, price_cents, status, customer_name, customer_phone, pet_name, pet_breed, notes, internal_notes')
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
    .select('id, business_id, service_name, size, size_label, starts_at, ends_at, duration_minutes, buffer_minutes, price_cents, status, customer_name, customer_phone, pet_name, pet_breed, notes, internal_notes')
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

export function createAdminBooking(businessId, optionId, startsAt, form) {
  return adminRpc('admin_create_booking', {
    p_business_id: businessId,
    p_option_id: optionId,
    p_starts_at: startsAt,
    p_customer_name: form.customerName,
    p_customer_phone: form.customerPhone,
    p_pet_name: form.petName,
    p_pet_breed: form.petBreed || null,
    p_notes: form.notes || null,
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

function throwIfApiError(error, operation) {
  if (!error) return
  console.error(`[${operation}]`, error.code)
  if (error.code === '23505') throw new ApiError('DUPLICATE_NAME')
  throw new ApiError('NETWORK')
}

export async function getBusinessControl(businessId) {
  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, logo_path, primary_color')
    .eq('id', businessId)
    .single()
  throwIfApiError(error, 'business control select')
  return data
}

export async function listBusinessCatalog(businessId) {
  const [sizesResult, servicesResult, optionsResult] = await Promise.all([
    supabase.from('business_sizes')
      .select('business_id, code, name, sort_order, is_active')
      .eq('business_id', businessId)
      .order('sort_order')
      .order('name'),
    supabase.from('services')
      .select('id, business_id, name, description, is_active, archived_at')
      .eq('business_id', businessId)
      .order('name'),
    supabase.from('service_options')
      .select('id, business_id, service_id, size, price_cents, duration_minutes, is_active')
      .eq('business_id', businessId),
  ])
  throwIfApiError(sizesResult.error, 'business sizes select')
  throwIfApiError(servicesResult.error, 'services select')
  throwIfApiError(optionsResult.error, 'service options select')
  return {
    sizes: sizesResult.data ?? [],
    services: (servicesResult.data ?? []).map((service) => ({
      ...service,
      options: (optionsResult.data ?? []).filter((option) => option.service_id === service.id),
    })),
  }
}

export async function updateBusinessProfile(businessId, profile) {
  const { data, error } = await supabase
    .from('businesses')
    .update({ name: profile.name, logo_path: profile.logo_path, primary_color: profile.primary_color })
    .eq('id', businessId)
    .select('id')
    .maybeSingle()
  throwIfApiError(error, 'business profile update')
  if (!data) throw new ApiError('AUTH_ACCESS_DENIED')
}

export async function uploadBusinessLogo(businessId, file) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.type]
  if (!extension || file.size === 0 || file.size > 1024 * 1024) throw new ApiError('INVALID_PROFILE_IMAGE')
  const path = `${businessId}/${globalThis.crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from('business-logos').upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) {
    console.error('[business logo upload]', error.statusCode)
    throw new ApiError('LOGO_UPLOAD_FAILED')
  }
  return path
}

export async function removeBusinessLogo(path) {
  if (!path) return
  const { error } = await supabase.storage.from('business-logos').remove([path])
  throwIfApiError(error, 'business logo removal')
}

export async function saveBusinessSize(businessId, size) {
  const query = supabase.from('business_sizes')
  const result = size.code
    ? await query.update({ name: size.name }).eq('business_id', businessId).eq('code', size.code).select('code').maybeSingle()
    : await query.insert({
      business_id: businessId,
      code: size.newCode,
      name: size.name,
      sort_order: size.sort_order,
    }).select('code').single()
  throwIfApiError(result.error, 'business size save')
  if (!result.data) throw new ApiError('AUTH_ACCESS_DENIED')
}

export async function setBusinessSizeActive(businessId, code, isActive) {
  const { data, error } = await supabase.from('business_sizes')
    .update({ is_active: isActive })
    .eq('business_id', businessId)
    .eq('code', code)
    .select('code')
    .maybeSingle()
  throwIfApiError(error, 'business size status')
  if (!data) throw new ApiError('AUTH_ACCESS_DENIED')
}

export async function saveService(businessId, service, options) {
  const serviceResult = service.id
    ? await supabase.from('services')
      .update({ name: service.name, description: service.description })
      .eq('business_id', businessId)
      .eq('id', service.id)
      .select('id')
      .maybeSingle()
    : await supabase.from('services')
      .insert({ business_id: businessId, name: service.name, description: service.description, is_active: true })
      .select('id')
      .single()
  throwIfApiError(serviceResult.error, 'service save')
  const serviceId = serviceResult.data?.id
  if (!serviceId) throw new ApiError('AUTH_ACCESS_DENIED')

  for (const option of options) {
    if (!option.id && !option.is_active) continue
    const result = option.id
      ? await supabase.from('service_options')
        .update({
          price_cents: option.price_cents,
          duration_minutes: option.duration_minutes,
          is_active: option.is_active,
        })
        .eq('business_id', businessId)
        .eq('id', option.id)
        .select('id')
        .maybeSingle()
      : await supabase.from('service_options')
        .insert({
          business_id: businessId,
          service_id: serviceId,
          size: option.size,
          price_cents: option.price_cents,
          duration_minutes: option.duration_minutes,
          is_active: option.is_active,
        })
        .select('id')
        .single()
    throwIfApiError(result.error, 'service option save')
    if (!result.data) throw new ApiError('AUTH_ACCESS_DENIED')
  }
}

export async function archiveService(businessId, serviceId) {
  const { data, error } = await supabase.from('services')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('id', serviceId)
    .select('id')
    .maybeSingle()
  throwIfApiError(error, 'service archive')
  if (!data) throw new ApiError('AUTH_ACCESS_DENIED')
}

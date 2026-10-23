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

export async function listPublicServiceCategories(slug) {
  return (await rpc('list_public_service_categories', { p_slug: slug })) ?? []
}

export async function listPublicBookingModels(slug) {
  return (await rpc('get_public_booking_models', { p_slug: slug })) ?? []
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

/** Orcamento da estadia: { available, nights, daily_price_cents, total_price_cents }. */
export async function getStayQuote(slug, optionId, checkIn, checkOut) {
  const data = await rpc('get_stay_quote', {
    p_slug: slug,
    p_option_id: optionId,
    p_check_in: checkIn,
    p_check_out: checkOut,
  })
  if (!data || data.ok !== true) throw new ApiError(data?.error ?? 'UNKNOWN')
  return data
}

/** Reserva a estadia. `idempotencyKey`: uma por confirmacao, reutilizada em retries. */
export async function createPublicStay({ slug, optionId, checkIn, checkOut, form, idempotencyKey }) {
  const data = await rpc('create_public_stay', {
    p_slug: slug,
    p_option_id: optionId,
    p_check_in: checkIn,
    p_check_out: checkOut,
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

export async function getPeriodQuote(slug, optionId, date, period) {
  const data = await rpc('get_period_quote', {
    p_slug: slug,
    p_option_id: optionId,
    p_date: date,
    p_period: period,
  })
  if (!data || data.ok !== true) throw new ApiError(data?.error ?? 'UNKNOWN')
  return data
}

export async function createPublicPeriodBooking({ slug, optionId, date, period, form, idempotencyKey }) {
  const data = await rpc('create_public_period_booking', {
    p_slug: slug,
    p_option_id: optionId,
    p_date: date,
    p_period: period,
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

export async function getTimedStayOptions(slug, optionId, checkIn, entryTime) {
  const data = await rpc('get_timed_stay_options', {
    p_slug: slug,
    p_option_id: optionId,
    p_check_in: checkIn,
    p_entry_time: entryTime,
  })
  if (!data || data.ok !== true) throw new ApiError(data?.error ?? 'UNKNOWN')
  return data
}

export async function createPublicTimedStay({
  slug, optionId, checkIn, entryTime, checkOut, exitTime, form, idempotencyKey,
}) {
  const data = await rpc('create_public_timed_stay', {
    p_slug: slug,
    p_option_id: optionId,
    p_check_in: checkIn,
    p_entry_time: entryTime,
    p_check_out: checkOut,
    p_exit_time: exitTime,
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

/** Estadias que cobrem a data (entrada, hospedado ou saida), sem canceladas. */
export async function listAdminStaysOnDate(businessId, date) {
  const { data, error } = await supabase
    .from('stay_bookings')
    .select('id, business_id, status, check_in, check_out, check_in_at, check_out_at, duration_minutes, charge_units, nights, service_name, size_label, daily_price_cents, total_price_cents, customer_name, customer_phone, pet_name, pet_breed, notes')
    .eq('business_id', businessId)
    .in('status', ['confirmed', 'completed'])
    .lte('check_in', date)
    .gte('check_out', date)
    .order('check_in', { ascending: true })
  if (error || !Array.isArray(data)) {
    if (error) console.error('[stays select]', error.code)
    throw new ApiError('NETWORK')
  }
  return data
}

export async function listAdminDaycareOnDate(businessId, date) {
  const data = await rpc('admin_list_daycare_on_date', {
    p_business_id: businessId,
    p_date: date,
  })
  if (!data || data.ok !== true || !Array.isArray(data.bookings)) {
    throw new ApiError(data?.error ?? 'UNKNOWN')
  }
  return data.bookings
}

export async function listAdminBookings(businessId, start, end) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, business_id, service_name, size, size_label, starts_at, ends_at, duration_minutes, buffer_minutes, price_cents, status, customer_name, customer_phone, pet_name, pet_breed, notes, internal_notes')
    .eq('business_id', businessId)
    .in('status', ['confirmed', 'completed'])
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

export async function listAdminBookingConflicts(businessId, start, end) {
  const { data, error } = await supabase.from('bookings')
    .select('id, status')
    .eq('business_id', businessId)
    .neq('status', 'cancelled')
    .lt('starts_at', end)
    .gt('ends_at', start)
  throwIfApiError(error, 'booking conflicts select')
  return data ?? []
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

export function setAdminStayStatus(stayId, status) {
  return adminRpc('admin_set_stay_status', {
    p_stay_id: stayId,
    p_status: status,
  })
}

export function setAdminDaycareStatus(bookingId, status) {
  return adminRpc('admin_set_daycare_status', {
    p_booking_id: bookingId,
    p_status: status,
  })
}

export function setAdminBookingStatus(bookingId, status) {
  return adminRpc('admin_set_booking_status', {
    p_booking_id: bookingId,
    p_status: status,
  })
}

export async function listBusinessHours(businessId) {
  const { data, error } = await supabase.from('business_hours')
    .select('id, business_id, day_of_week, opens_minute, closes_minute')
    .eq('business_id', businessId)
    .order('day_of_week')
    .order('opens_minute')
  throwIfApiError(error, 'business hours select')
  return data ?? []
}

export function replaceBusinessHours(businessId, hours) {
  return adminRpc('admin_replace_business_hours', {
    p_business_id: businessId,
    p_hours: hours,
  })
}

export async function listAdminTimeBlocks(businessId, start, end) {
  const { data, error } = await supabase.from('time_blocks')
    .select('id, starts_at, ends_at, reason')
    .eq('business_id', businessId)
    .lt('starts_at', end)
    .gt('ends_at', start)
    .order('starts_at')
  throwIfApiError(error, 'time blocks select')
  return data ?? []
}

export function createAdminTimeBlock(businessId, startsAt, endsAt, reason) {
  return adminRpc('admin_create_time_block', {
    p_business_id: businessId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_reason: reason,
  })
}

export async function deleteAdminTimeBlock(businessId, blockId) {
  const { data, error } = await supabase.from('time_blocks')
    .delete()
    .eq('business_id', businessId)
    .eq('id', blockId)
    .select('id')
    .maybeSingle()
  throwIfApiError(error, 'time block delete')
  if (!data) throw new ApiError('AUTH_ACCESS_DENIED')
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
    .select('id, name, logo_path, primary_color, contact_phone')
    .eq('id', businessId)
    .single()
  throwIfApiError(error, 'business control select')
  return data
}

export async function listBusinessCatalog(businessId) {
  const [sizesResult, categoriesResult, servicesResult, optionsResult, settingsResult] = await Promise.all([
    supabase.from('business_sizes')
      .select('business_id, code, name, sort_order, is_active')
      .eq('business_id', businessId)
      .order('sort_order')
      .order('name'),
    supabase.from('service_categories')
      .select('id, business_id, name, description, sort_order')
      .eq('business_id', businessId)
      .order('sort_order')
      .order('name'),
    supabase.from('services')
      .select('id, business_id, category_id, name, description, booking_mode, is_active, archived_at')
      .eq('business_id', businessId)
      .order('name'),
    supabase.from('service_options')
      .select('id, business_id, service_id, size, price_cents, duration_minutes, morning_price_cents, afternoon_price_cents, full_day_price_cents, is_active')
      .eq('business_id', businessId),
    supabase.from('service_booking_settings')
      .select('service_id, business_id, morning_start, morning_end, afternoon_start, afternoon_end, check_in_start, check_in_end, check_out_start, check_out_end')
      .eq('business_id', businessId),
  ])
  throwIfApiError(sizesResult.error, 'business sizes select')
  throwIfApiError(categoriesResult.error, 'service categories select')
  throwIfApiError(servicesResult.error, 'services select')
  throwIfApiError(optionsResult.error, 'service options select')
  throwIfApiError(settingsResult.error, 'service booking settings select')
  return {
    sizes: sizesResult.data ?? [],
    categories: categoriesResult.data ?? [],
    services: (servicesResult.data ?? []).map((service) => ({
      ...service,
      options: (optionsResult.data ?? []).filter((option) => option.service_id === service.id),
      settings: (settingsResult.data ?? []).find((settings) => settings.service_id === service.id) ?? null,
    })),
  }
}

export async function updateBusinessProfile(businessId, profile) {
  const { data, error } = await supabase
    .from('businesses')
    .update({
      name: profile.name,
      logo_path: profile.logo_path,
      primary_color: profile.primary_color,
      contact_phone: profile.contact_phone,
    })
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

export async function saveServiceCategory(businessId, category) {
  const query = supabase.from('service_categories')
  const result = category.id
    ? await query.update({ name: category.name, description: category.description })
      .eq('business_id', businessId)
      .eq('id', category.id)
      .select('id')
      .maybeSingle()
    : await query.insert({
      business_id: businessId,
      name: category.name,
      description: category.description,
      sort_order: category.sort_order,
    }).select('id').single()
  throwIfApiError(result.error, 'service category save')
  if (!result.data) throw new ApiError('AUTH_ACCESS_DENIED')
}

export async function deleteServiceCategory(categoryId) {
  await adminRpc('admin_delete_service_category', { p_category_id: categoryId })
}

export async function saveService(businessId, service, options, settings) {
  const bookingMode = ['daily', 'periods', 'stay'].includes(service.booking_mode)
    ? service.booking_mode
    : 'hourly'
  const serviceResult = service.id
    ? await supabase.from('services')
      .update({
        category_id: service.category_id,
        name: service.name,
        description: service.description,
        booking_mode: bookingMode,
      })
      .eq('business_id', businessId)
      .eq('id', service.id)
      .select('id')
      .maybeSingle()
    : await supabase.from('services')
      .insert({
        business_id: businessId,
        category_id: service.category_id,
        name: service.name,
        description: service.description,
        booking_mode: bookingMode,
        is_active: true,
      })
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
          morning_price_cents: option.morning_price_cents ?? null,
          afternoon_price_cents: option.afternoon_price_cents ?? null,
          full_day_price_cents: option.full_day_price_cents ?? null,
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
          morning_price_cents: option.morning_price_cents ?? null,
          afternoon_price_cents: option.afternoon_price_cents ?? null,
          full_day_price_cents: option.full_day_price_cents ?? null,
          is_active: option.is_active,
        })
        .select('id')
        .single()
    throwIfApiError(result.error, 'service option save')
    if (!result.data) throw new ApiError('AUTH_ACCESS_DENIED')
  }
  await adminRpc('admin_save_service_booking_settings', {
    p_service_id: serviceId,
    p_config: settings ?? {},
  })
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

export async function reactivateService(businessId, serviceId) {
  const { data, error } = await supabase.from('services')
    .update({ is_active: true, archived_at: null })
    .eq('business_id', businessId)
    .eq('id', serviceId)
    .select('id')
    .maybeSingle()
  throwIfApiError(error, 'service reactivate')
  if (!data) throw new ApiError('AUTH_ACCESS_DENIED')
}

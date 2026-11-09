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

/** Faixas de peso dos portes ativos (opcional: sem a migration devolve lista vazia). */
export async function listPublicSizes(slug) {
  try {
    return (await rpc('list_public_sizes', { p_slug: slug })) ?? []
  } catch {
    return []
  }
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

// ---------------------------------------------------------------------------
// Versoes do PAINEL: sem janela de datas (agendar meses a frente). Se a funcao ainda nao existe no
// banco (migration nao aplicada), cai na versao publica, que respeita a janela do cliente.
// ---------------------------------------------------------------------------
const FUNCTION_NOT_FOUND = 'PGRST202'

async function adminRpcOrPublic(adminFn, adminArgs, publicFn, publicArgs) {
  let res
  try {
    res = await supabase.rpc(adminFn, adminArgs)
  } catch {
    throw new ApiError('NETWORK')
  }
  if (res.error?.code === FUNCTION_NOT_FOUND) return rpc(publicFn, publicArgs)
  if (res.error) {
    console.error(`[rpc ${adminFn}]`, res.error.code)
    throw new ApiError('NETWORK')
  }
  return res.data
}

/** Horarios livres para o painel. business: { id, slug }. */
export async function getAdminAvailableSlots(business, optionId, date) {
  return (await adminRpcOrPublic(
    'admin_get_available_slots', { p_business_id: business.id, p_option_id: optionId, p_date: date },
    'get_available_slots', { p_slug: business.slug, p_option_id: optionId, p_date: date },
  )) ?? []
}

/** Cotacao da creche para o painel. */
export async function getAdminPeriodQuote(business, optionId, date, period) {
  const data = await adminRpcOrPublic(
    'admin_get_period_quote', { p_business_id: business.id, p_option_id: optionId, p_date: date, p_period: period },
    'get_period_quote', { p_slug: business.slug, p_option_id: optionId, p_date: date, p_period: period },
  )
  if (!data || data.ok !== true) throw new ApiError(data?.error ?? 'UNKNOWN')
  return data
}

/** Opcoes de saida da hospedagem para o painel. */
export async function getAdminTimedStayOptions(business, optionId, checkIn, entryTime) {
  const data = await adminRpcOrPublic(
    'admin_get_timed_stay_options', { p_business_id: business.id, p_option_id: optionId, p_check_in: checkIn, p_entry_time: entryTime },
    'get_timed_stay_options', { p_slug: business.slug, p_option_id: optionId, p_check_in: checkIn, p_entry_time: entryTime },
  )
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

/** Creche por periodos criada pelo painel. */
export function createAdminPeriodBooking(businessId, { optionId, date, period }, form) {
  return adminRpc('admin_create_period_booking', {
    p_business_id: businessId,
    p_option_id: optionId,
    p_date: date,
    p_period: period,
    p_customer_name: form.customerName,
    p_customer_phone: form.customerPhone,
    p_pet_name: form.petName,
    p_pet_breed: form.petBreed || null,
    p_notes: form.notes || null,
  })
}

/** Hospedagem com entrada e saida criada pelo painel. */
export function createAdminTimedStay(businessId, { optionId, checkIn, entryTime, checkOut, exitTime }, form) {
  return adminRpc('admin_create_timed_stay', {
    p_business_id: businessId,
    p_option_id: optionId,
    p_check_in: checkIn,
    p_entry_time: entryTime,
    p_check_out: checkOut,
    p_exit_time: exitTime,
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

const UNDEFINED_COLUMN = '42703' // Postgres: coluna ainda nao existe (migration nao aplicada)

export async function getBusinessControl(businessId) {
  const base = 'id, name, logo_path, primary_color, contact_phone'
  const run = (columns) => supabase.from('businesses').select(columns).eq('id', businessId).single()
  let { data, error } = await run(`${base}, transport_start_fee_cents, transport_km_price_cents`)
  // Sem a migration do leva e traz o Controle continua abrindo (sem a secao de valores).
  if (error?.code === UNDEFINED_COLUMN) ({ data, error } = await run(base))
  throwIfApiError(error, 'business control select')
  return data
}

async function fetchCatalogSizes(businessId) {
  const base = 'business_id, code, name, sort_order, is_active'
  const run = (columns) => supabase.from('business_sizes').select(columns).eq('business_id', businessId).order('sort_order').order('name')
  const result = await run(`${base}, weight_min_kg, weight_max_kg`)
  return result.error?.code === UNDEFINED_COLUMN ? run(base) : result
}

async function fetchCatalogServices(businessId) {
  const base = 'id, business_id, category_id, name, description, booking_mode, is_active, archived_at'
  const run = (columns) => supabase.from('services').select(columns).eq('business_id', businessId).order('name')
  const result = await run(`${base}, transport_enabled`)
  return result.error?.code === UNDEFINED_COLUMN ? run(base) : result
}

export async function listBusinessCatalog(businessId) {
  const [sizesResult, categoriesResult, servicesResult, optionsResult, settingsResult] = await Promise.all([
    fetchCatalogSizes(businessId),
    supabase.from('service_categories')
      .select('id, business_id, name, description, sort_order')
      .eq('business_id', businessId)
      .order('sort_order')
      .order('name'),
    fetchCatalogServices(businessId),
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

// Faixa de peso (kg): so vai para o banco quando a tela conhece a coluna (migration aplicada).
function weightColumns(size) {
  return size.weightMinKg === undefined ? {}
    : { weight_min_kg: size.weightMinKg, weight_max_kg: size.weightMaxKg }
}

export async function saveBusinessSize(businessId, size) {
  const query = supabase.from('business_sizes')
  const result = size.code
    ? await query.update({ name: size.name, ...weightColumns(size) }).eq('business_id', businessId).eq('code', size.code).select('code').maybeSingle()
    : await query.insert({
      business_id: businessId,
      code: size.newCode,
      name: size.name,
      sort_order: size.sort_order,
      ...weightColumns(size),
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

// So grava transport_enabled quando a tela conhece a coluna (migration aplicada).
function transportColumn(service) {
  return typeof service.transport_enabled === 'boolean' ? { transport_enabled: service.transport_enabled } : {}
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
        ...transportColumn(service),
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
        ...transportColumn(service),
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

// ---------------------------------------------------------------------------
// Leva e traz. Tipos de reserva: 'booking' (horario), 'stay' (hospedagem), 'daycare' (creche).
// ---------------------------------------------------------------------------
const TRANSPORT_KIND_COLUMN = { booking: 'booking_id', stay: 'stay_id', daycare: 'daycare_id' }
const TRANSPORT_COLUMNS = 'id, business_id, booking_id, stay_id, daycare_id, status, requested_by, street, street_number, neighborhood, city, complement, reference, distance_km, start_fee_cents, km_price_cents, freight_cents, quoted_at, confirmed_at, created_at'

/** Cliente: { enabled, request_status } da reserva. */
export async function getTransportState(slug, kind, ref) {
  const data = await rpc('get_transport_state', { p_slug: slug, p_kind: kind, p_ref: ref })
  if (!data || data.ok !== true) throw new ApiError(data?.error ?? 'UNKNOWN')
  return data
}

/** Cliente: registra o pedido com o endereco (sem valor). */
export async function requestTransport({ slug, kind, ref, address }) {
  const data = await rpc('request_transport', {
    p_slug: slug,
    p_kind: kind,
    p_ref: ref,
    p_street: address.street,
    p_number: address.number,
    p_neighborhood: address.neighborhood,
    p_city: address.city || null,
    p_complement: address.complement || null,
    p_reference: address.reference || null,
  })
  if (!data || data.ok !== true) throw new ApiError(data?.error ?? 'UNKNOWN')
  return data
}

/** Painel: pedidos das reservas listadas. null = recurso indisponivel (migration nao aplicada). */
export async function listTransportFor(businessId, kind, ids) {
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('transport_requests')
    .select(TRANSPORT_COLUMNS)
    .eq('business_id', businessId)
    .in(TRANSPORT_KIND_COLUMN[kind], ids)
  if (error || !Array.isArray(data)) {
    if (error) console.error('[transport select]', error.code)
    return null
  }
  return data
}

/** Painel: pedidos que ainda pedem acao (solicitado ou cotado). null = indisponivel. */
export async function listOpenTransport(businessId) {
  const { data, error } = await supabase
    .from('transport_requests')
    .select(TRANSPORT_COLUMNS)
    .eq('business_id', businessId)
    .in('status', ['requested', 'quoted'])
    .order('created_at', { ascending: true })
    .limit(50)
  if (error || !Array.isArray(data)) {
    if (error) console.error('[transport open select]', error.code)
    return null
  }
  return data
}

/** Painel: resumo das reservas ligadas aos pedidos (para a caixa de pedidos do Inicio). */
export async function listReservationsForTransport(businessId, requests) {
  const ids = (column) => requests.map((request) => request[column]).filter(Boolean)
  const select = (table, columns, idList) => idList.length
    ? supabase.from(table).select(columns).eq('business_id', businessId).in('id', idList)
    : Promise.resolve({ data: [], error: null })
  const common = 'id, status, service_name, customer_name, customer_phone, pet_name'
  const [bookings, stays, daycare] = await Promise.all([
    select('bookings', `${common}, starts_at, price_cents`, ids('booking_id')),
    select('stay_bookings', `${common}, check_in, check_out, total_price_cents`, ids('stay_id')),
    select('daycare_bookings', `${common}, period, starts_at, price_cents`, ids('daycare_id')),
  ])
  for (const result of [bookings, stays, daycare]) throwIfApiError(result.error, 'transport reservations select')
  return { booking: bookings.data ?? [], stay: stays.data ?? [], daycare: daycare.data ?? [] }
}

/** Painel: salva a cotacao. O frete e calculado no banco a partir dos km de ida informados. */
export function saveTransportQuote({ kind, reservationId, address, distanceKm, startFeeCents, kmPriceCents }) {
  return adminRpc('admin_save_transport_quote', {
    p_kind: kind,
    p_reservation_id: reservationId,
    p_street: address.street,
    p_number: address.number || null,
    p_neighborhood: address.neighborhood || null,
    p_city: address.city || null,
    p_complement: address.complement || null,
    p_reference: address.reference || null,
    p_distance_km: distanceKm,
    p_start_fee_cents: startFeeCents,
    p_km_price_cents: kmPriceCents,
  })
}

/** Painel: 'confirmed' soma no total, 'quoted' desfaz a confirmacao, 'cancelled' encerra o pedido. */
export function setTransportStatus(requestId, status) {
  return adminRpc('admin_set_transport_status', { p_request_id: requestId, p_status: status })
}

/** Painel: valores padrao da taxa de partida e do valor por km. */
export async function updateTransportDefaults(businessId, { startFeeCents, kmPriceCents }) {
  const { data, error } = await supabase
    .from('businesses')
    .update({ transport_start_fee_cents: startFeeCents, transport_km_price_cents: kmPriceCents })
    .eq('id', businessId)
    .select('id')
    .maybeSingle()
  throwIfApiError(error, 'transport defaults update')
  if (!data) throw new ApiError('AUTH_ACCESS_DENIED')
}

// ---------------------------------------------------------------------------
// Visao geral das reservas marcadas e busca por codigo (aba Calendario).
// ---------------------------------------------------------------------------
const UPCOMING_LIMIT = 150
const UPCOMING_COMMON = 'id, status, service_name, size_label, customer_name, customer_phone, pet_name, pet_breed, notes'

/** Reservas confirmadas de hoje em diante, dos tres tipos, em ordem de data. */
export async function listUpcomingReservations(businessId, { todayYmd, startIso }) {
  const [bookings, stays, daycare] = await Promise.all([
    supabase.from('bookings').select(`${UPCOMING_COMMON}, price_cents, starts_at, ends_at, internal_notes`)
      .eq('business_id', businessId).eq('status', 'confirmed').gte('starts_at', startIso)
      .order('starts_at', { ascending: true }).limit(UPCOMING_LIMIT),
    supabase.from('stay_bookings').select(`${UPCOMING_COMMON}, total_price_cents, check_in, check_out, check_in_at, check_out_at`)
      .eq('business_id', businessId).eq('status', 'confirmed').gte('check_out', todayYmd)
      .order('check_in', { ascending: true }).limit(UPCOMING_LIMIT),
    supabase.from('daycare_bookings').select(`${UPCOMING_COMMON}, price_cents, period, starts_at, ends_at`)
      .eq('business_id', businessId).eq('status', 'confirmed').gte('starts_at', startIso)
      .order('starts_at', { ascending: true }).limit(UPCOMING_LIMIT),
  ])
  for (const result of [bookings, stays, daycare]) throwIfApiError(result.error, 'upcoming reservations select')
  return {
    booking: bookings.data ?? [],
    stay: stays.data ?? [],
    daycare: daycare.data ?? [],
    limit: UPCOMING_LIMIT,
  }
}

/** Reservas por codigo, nome do tutor ou pet (qualquer data, qualquer status). */
export async function searchReservations(businessId, query) {
  const data = await adminRpc('admin_search_reservations', { p_business_id: businessId, p_query: query })
  return { results: data.results ?? [], truncated: data.truncated === true }
}

/** Reservas cujo codigo comeca com o texto digitado (compatibilidade com chamadas existentes). */
export async function findReservationsByCode(businessId, code) {
  const data = await adminRpc('admin_find_reservations_by_code', { p_business_id: businessId, p_code: code })
  return data.results ?? []
}

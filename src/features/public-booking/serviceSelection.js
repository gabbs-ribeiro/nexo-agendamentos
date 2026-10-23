export function findSelectedService(services, optionId) {
  for (const service of services) {
    const option = service.options.find((item) => item.option_id === optionId)
    if (option) return { service, option }
  }
  return null
}

export function startingPrice(options) {
  if (!options.length) return null
  return Math.min(...options.map((option) => option.price_cents))
}

export function displayedPrice(service, option) {
  if (service?.booking_mode !== 'periods') return option.price_cents
  const prices = [
    option.morning_price_cents,
    option.afternoon_price_cents,
    option.full_day_price_cents,
  ].filter(Number.isInteger)
  return prices.length ? Math.min(...prices) : option.price_cents
}

export function serviceStartingPrice(service) {
  if (service?.booking_mode !== 'periods') return startingPrice(service?.options ?? [])
  const prices = (service?.options ?? []).flatMap((option) => [
    option.morning_price_cents,
    option.afternoon_price_cents,
    option.full_day_price_cents,
  ]).filter(Number.isInteger)
  return prices.length ? Math.min(...prices) : startingPrice(service?.options ?? [])
}

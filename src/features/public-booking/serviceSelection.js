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

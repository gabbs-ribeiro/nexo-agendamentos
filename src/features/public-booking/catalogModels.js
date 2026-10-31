// Junta o catalogo por categoria com o modelo de reserva de cada servico
// (horario, periodos, hospedagem), como o link publico faz.
export function mergeBookingModels(services, models) {
  const modelByService = new Map(models.map((model) => [model.service_id, model]))
  return services.map((service) => {
    const model = modelByService.get(service.service_id)
    if (!model) return service
    const prices = new Map((model.options ?? []).map((item) => [item.option_id, item]))
    return {
      ...service,
      booking_mode: model.booking_mode,
      booking_settings: model.settings,
      options: service.options.map((option) => ({ ...option, ...prices.get(option.option_id) })),
    }
  })
}

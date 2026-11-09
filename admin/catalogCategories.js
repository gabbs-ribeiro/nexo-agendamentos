export function groupServicesByCategory(categories, services) {
  return categories.map((category) => ({
    ...category,
    services: services.filter((service) => service.category_id === category.id),
  }))
}

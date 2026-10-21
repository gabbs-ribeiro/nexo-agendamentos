export function publicBookingUrl(origin, slug) {
  return `${origin.replace(/\/$/, '')}/${encodeURIComponent(slug)}`
}

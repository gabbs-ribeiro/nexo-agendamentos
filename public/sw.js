self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Novo agendamento', {
    body: data.body || 'Um novo agendamento foi recebido.',
    tag: data.tag || 'novo-agendamento',
    data: { url: data.url || '/admin' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = event.notification.data?.url
  const safePath = typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
    ? path
    : '/admin'
  const target = new URL(safePath, self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) {
      await existing.navigate(target)
      return existing.focus()
    }
    return self.clients.openWindow(target)
  })())
})

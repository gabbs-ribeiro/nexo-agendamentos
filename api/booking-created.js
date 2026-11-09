import { timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { sendNotification, setVapidDetails } from 'web-push'

const BOOKING_TABLES = new Set(['bookings', 'daycare_bookings', 'stay_bookings'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isAuthorized(request, secret) {
  const provided = request.headers?.authorization ?? ''
  const expected = `Bearer ${secret}`
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer)
}

async function releaseEventClaim(supabase, eventKey) {
  const { error } = await supabase
    .from('push_notification_events')
    .delete()
    .eq('event_key', eventKey)
  if (error) console.error('Could not release push event', error.code ?? 'unknown')
}

function parseWebhookBody(body) {
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_WEBHOOK_SECRET,
    VAPID_PRIVATE_KEY,
    VAPID_PUBLIC_KEY,
    VAPID_SUBJECT,
  } = process.env

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_WEBHOOK_SECRET
    || !VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY || !VAPID_SUBJECT) {
    console.error('Push notification environment is incomplete')
    return response.status(500).json({ error: 'Push notifications are not configured' })
  }

  if (!isAuthorized(request, SUPABASE_WEBHOOK_SECRET)) {
    return response.status(401).json({ error: 'Unauthorized' })
  }

  const event = parseWebhookBody(request.body)
  const record = event?.record
  if (event?.type !== 'INSERT' || event?.schema !== 'public' || !BOOKING_TABLES.has(event?.table)
    || !UUID_PATTERN.test(record?.id ?? '') || !UUID_PATTERN.test(record?.business_id ?? '')) {
    return response.status(400).json({ error: 'Invalid booking event' })
  }

  const eventKey = `${event.table}:${record.id}`
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error: eventError } = await supabase
    .from('push_notification_events')
    .insert({ event_key: eventKey })

  if (eventError?.code === '23505') return response.status(200).json({ ok: true, duplicate: true })
  if (eventError) {
    console.error('Could not record push event', eventError.code ?? 'unknown')
    return response.status(500).json({ error: 'Could not process booking event' })
  }

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('business_id', record.business_id)

  if (subscriptionsError) {
    await releaseEventClaim(supabase, eventKey)
    console.error('Could not load push subscriptions', subscriptionsError.code ?? 'unknown')
    return response.status(500).json({ error: 'Could not load push subscriptions' })
  }

  if (!Array.isArray(subscriptions)) {
    await releaseEventClaim(supabase, eventKey)
    console.error('Could not load push subscriptions', 'invalid response')
    return response.status(500).json({ error: 'Could not load push subscriptions' })
  }

  if (!subscriptions.length) return response.status(200).json({ ok: true, sent: 0 })

  try {
    setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  } catch {
    await releaseEventClaim(supabase, eventKey)
    console.error('VAPID configuration is invalid')
    return response.status(500).json({ error: 'Push notifications are not configured correctly' })
  }
  const payload = JSON.stringify({
    title: 'Novo agendamento',
    body: 'Um novo agendamento foi recebido.',
    url: '/admin',
    tag: eventKey,
  })

  const results = await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload)
      return 'sent'
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        const { error: deleteError } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('id', subscription.id)
        if (deleteError) console.error('Could not remove expired push subscription', deleteError.code ?? 'unknown')
        return 'expired'
      }
      return 'failed'
    }
  }))

  const failed = results.filter((result) => result === 'failed').length
  if (failed) {
    await releaseEventClaim(supabase, eventKey)
    console.error('Push delivery failed', { failed })
    return response.status(503).json({ error: 'Push delivery failed' })
  }

  return response.status(200).json({
    ok: true,
    sent: results.filter((result) => result === 'sent').length,
  })
}

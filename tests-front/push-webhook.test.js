import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/booking-created.js'

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

test('webhook push recusa metodo diferente de POST', async () => {
  const response = createResponse()
  await handler({ method: 'GET', headers: {} }, response)
  assert.equal(response.statusCode, 405)
  assert.equal(response.headers.Allow, 'POST')
})

test('webhook push exige o segredo configurado', async () => {
  const names = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_WEBHOOK_SECRET',
    'VAPID_PRIVATE_KEY',
    'VAPID_PUBLIC_KEY',
    'VAPID_SUBJECT',
  ]
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  Object.assign(process.env, {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
    SUPABASE_WEBHOOK_SECRET: 'test-webhook-secret',
    VAPID_PRIVATE_KEY: 'test-private-key',
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_SUBJECT: 'mailto:test@example.com',
  })

  try {
    const response = createResponse()
    await handler({ method: 'POST', headers: { authorization: 'Bearer invalid' }, body: {} }, response)
    assert.equal(response.statusCode, 401)
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeVapidPublicKey } from '../src/lib/pushNotifications.js'

test('decodifica a chave publica VAPID em base64url', () => {
  assert.deepEqual([...decodeVapidPublicKey('AQIDBA')], [1, 2, 3, 4])
  assert.deepEqual([...decodeVapidPublicKey('_w')], [255])
})

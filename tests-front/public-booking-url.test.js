import test from 'node:test'
import assert from 'node:assert/strict'
import { publicBookingUrl } from '../src/features/admin/publicBookingUrl.js'

test('link publico usa a origem atual e o slug do estabelecimento', () => {
  assert.equal(publicBookingUrl('https://exemplo.com/', 'pet-shop'), 'https://exemplo.com/pet-shop')
})

test('slug e codificado sem permitir alterar o caminho do link', () => {
  assert.equal(publicBookingUrl('https://exemplo.com', 'pet shop'), 'https://exemplo.com/pet%20shop')
})

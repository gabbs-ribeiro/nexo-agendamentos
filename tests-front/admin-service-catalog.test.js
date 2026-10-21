import test from 'node:test'
import assert from 'node:assert/strict'
import { priceToCents, sizeCodeForName } from '../src/features/admin/serviceCatalog.js'

test('converte preços em reais para centavos sem arredondar valores inválidos', () => {
  assert.equal(priceToCents('49,90'), 4990)
  assert.equal(priceToCents('0'), 0)
  assert.equal(priceToCents('12.5'), 1250)
  assert.equal(priceToCents('12,345'), null)
  assert.equal(priceToCents('-1,00'), null)
  assert.equal(priceToCents(''), null)
})

test('gera código estável e válido para porte customizado', () => {
  assert.equal(sizeCodeForName('Porte Extra Grande', '1234-5678-90ab'), 'porte-extra-grande-1234567890ab')
  assert.equal(sizeCodeForName('🐕', '1234-5678-90ab'), 'porte-1234567890ab')
})

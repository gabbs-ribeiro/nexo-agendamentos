import test from 'node:test'
import assert from 'node:assert/strict'
import { findSelectedService, startingPrice } from '../src/features/public-booking/serviceSelection.js'

const services = [
  {
    service_id: 'bath',
    name: 'Banho',
    options: [
      { option_id: 'bath-small', price_cents: 5000 },
      { option_id: 'bath-large', price_cents: 9000 },
    ],
  },
  {
    service_id: 'groom',
    name: 'Tosa',
    options: [{ option_id: 'groom-small', price_cents: 7000 }],
  },
]

test('preço inicial é o menor valor entre os portes disponíveis', () => {
  assert.equal(startingPrice(services[0].options), 5000)
  assert.equal(startingPrice([]), null)
})

test('opção escolhida determina serviço, porte, valor e duração', () => {
  assert.deepEqual(findSelectedService(services, 'bath-large'), {
    service: services[0],
    option: services[0].options[1],
  })
  assert.equal(findSelectedService(services, 'missing'), null)
})

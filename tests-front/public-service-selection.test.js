import test from 'node:test'
import assert from 'node:assert/strict'
import {
  displayedPrice, findSelectedService, serviceStartingPrice, startingPrice,
} from '../src/features/public-booking/serviceSelection.js'

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

test('modelos por período mostram o menor preço configurado entre as modalidades', () => {
  const service = {
    booking_mode: 'periods',
    options: [
      { option_id: 'small', price_cents: 3000, morning_price_cents: 3000, afternoon_price_cents: 3500, full_day_price_cents: 6000 },
      { option_id: 'large', price_cents: 5000, morning_price_cents: 5000, afternoon_price_cents: 4500, full_day_price_cents: 8500 },
    ],
  }
  assert.equal(displayedPrice(service, service.options[0]), 3000)
  assert.equal(serviceStartingPrice(service), 3000)
})

test('opção escolhida determina serviço, porte, valor e duração', () => {
  assert.deepEqual(findSelectedService(services, 'bath-large'), {
    service: services[0],
    option: services[0].options[1],
  })
  assert.equal(findSelectedService(services, ''), null)
  assert.equal(findSelectedService(services, 'missing'), null)
})

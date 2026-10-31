import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addressLines, adminWhatsappUrl, calcFreight, centsToInput, customerWhatsappUrl, kmLabel,
  mapsSearchUrl, parseKm, parseMoneyToCents, totalWithTransport,
} from '../src/features/transport/transportCalc.js'

test('exemplo da regra: 6 km de ida = 24 km, R$ 24 + R$ 5 = R$ 29', () => {
  const result = calcFreight({ distanceKm: 6, startFeeCents: 500, kmPriceCents: 100 })
  assert.equal(result.totalKm, 24)
  assert.equal(result.kmCostCents, 2400)
  assert.equal(result.freightCents, 2900)
})

test('exemplo do planejamento: 2 km de ida = 8 km, R$ 8 + R$ 5 = R$ 13', () => {
  assert.equal(calcFreight({ distanceKm: 2, startFeeCents: 500, kmPriceCents: 100 }).freightCents, 1300)
})

test('decimais e valores editaveis (mesmo arredondamento do banco)', () => {
  assert.equal(calcFreight({ distanceKm: 6.5, startFeeCents: 500, kmPriceCents: 75 }).freightCents, 2450)
  assert.equal(calcFreight({ distanceKm: 6.5, startFeeCents: 500, kmPriceCents: 100 }).freightCents, 3100)
  assert.equal(calcFreight({ distanceKm: 0.1, startFeeCents: 0, kmPriceCents: 125 }).freightCents, 50) // 0,4 km x 1,25
  assert.equal(calcFreight({ distanceKm: 3.3, startFeeCents: 500, kmPriceCents: 133 }).kmCostCents, Math.round(33 * 4 * 133 / 10))
  assert.equal(calcFreight({ distanceKm: 4, startFeeCents: 0, kmPriceCents: 0 }).freightCents, 0)
})

test('sem km valido nao calcula', () => {
  assert.equal(calcFreight({ distanceKm: 0, startFeeCents: 500, kmPriceCents: 100 }), null)
  assert.equal(calcFreight({ distanceKm: null, startFeeCents: 500, kmPriceCents: 100 }), null)
  assert.equal(calcFreight({ distanceKm: 5, startFeeCents: null, kmPriceCents: 100 }), null)
})

test('le km e dinheiro digitados', () => {
  assert.equal(parseKm('6'), 6)
  assert.equal(parseKm('6,5'), 6.5)
  assert.equal(parseKm(' 6.54 '), 6.5)
  assert.equal(parseKm('0'), null)
  assert.equal(parseKm('-3'), null)
  assert.equal(parseKm('abc'), null)
  assert.equal(parseKm('201'), null)
  assert.equal(parseKm(''), null)
  assert.equal(parseMoneyToCents('5'), 500)
  assert.equal(parseMoneyToCents('R$ 1,25'), 125)
  assert.equal(parseMoneyToCents('0'), 0)
  assert.equal(parseMoneyToCents('1000,01'), null)
  assert.equal(parseMoneyToCents('1,234'), null)
  assert.equal(parseMoneyToCents('x'), null)
  assert.equal(centsToInput(500), '5,00')
  assert.equal(centsToInput(125), '1,25')
  assert.equal(kmLabel(6.5), '6,5 km')
  assert.equal(kmLabel(24), '24 km')
})

test('frete so soma no total quando confirmado', () => {
  assert.equal(totalWithTransport(5000, { status: 'confirmed', freight_cents: 2900 }), 7900)
  assert.equal(totalWithTransport(5000, { status: 'quoted', freight_cents: 2900 }), 5000)
  assert.equal(totalWithTransport(5000, { status: 'requested', freight_cents: null }), 5000)
  assert.equal(totalWithTransport(5000, { status: 'cancelled', freight_cents: 2900 }), 5000)
  assert.equal(totalWithTransport(5000, null), 5000)
})

const address = { street: 'Rua das Flores', street_number: '123', neighborhood: 'Centro', city: 'Colombo', complement: 'Casa 2', reference: 'Perto da padaria' }

test('endereco organizado e link do Maps', () => {
  assert.deepEqual(addressLines(address), [
    'Rua das Flores, 123', 'Centro', 'Colombo', 'Complemento: Casa 2', 'Ponto de referência: Perto da padaria',
  ])
  assert.deepEqual(addressLines({ street: 'Rua B', number: '5', neighborhood: 'Alto' }), ['Rua B, 5', 'Alto'])
  const url = mapsSearchUrl(address)
  assert.ok(url.startsWith('https://www.google.com/maps/search/?api=1&query='))
  assert.ok(decodeURIComponent(url).includes('Rua das Flores, 123, Centro, Colombo'))
})

test('mensagem do cliente leva o endereco e NAO leva valor', () => {
  const url = customerWhatsappUrl({
    businessPhone: '(41) 99999-1111', serviceName: 'Banho', whenLabel: 'sábado, 25 de outubro às 08:00', code: 'AB12CD34', address,
  })
  assert.ok(url.startsWith('https://wa.me/5541999991111?text='))
  const text = decodeURIComponent(url.split('?text=')[1])
  assert.ok(text.includes('Rua das Flores, 123'))
  assert.ok(text.includes('Código da reserva: AB12CD34'))
  assert.ok(text.includes(mapsSearchUrl(address)), 'a mensagem do cliente leva o mesmo link do Maps do painel')
  assert.ok(text.indexOf('Mapa:') > text.indexOf('Rua das Flores, 123'), 'o mapa vem depois do endereco')
  assert.ok(!/R\$/.test(text) && !/\d+,\d{2}/.test(text), 'a mensagem do cliente nao pode ter valor')
  assert.equal(customerWhatsappUrl({ businessPhone: '', serviceName: 'x', address }), null)
})

test('mensagem da responsavel leva o valor e a pergunta de confirmacao', () => {
  const url = adminWhatsappUrl({
    customerPhone: '41988887777', businessName: 'Patitas', customerName: 'Ana', petName: 'Rex',
    serviceName: 'Banho', whenLabel: '25/10 às 08:00', freightCents: 2900,
  })
  assert.ok(url.startsWith('https://wa.me/5541988887777?text='))
  const text = decodeURIComponent(url.split('?text=')[1])
  assert.ok(/R\$\s*29,00/.test(text))
  assert.ok(text.includes('Rex') && text.includes('Banho') && text.includes('confirma'))
  assert.ok(text.includes('combinar o horário'))
  assert.equal(adminWhatsappUrl({ customerPhone: '123', businessName: 'x', customerName: 'a', petName: 'b', serviceName: 'c', freightCents: 100 }), null)
})

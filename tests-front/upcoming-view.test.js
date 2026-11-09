import test from 'node:test'
import assert from 'node:assert/strict'
import { shortCode } from '../src/lib/format.js'
import {
  canSearch, dateHeading, filterByCode, filterBySearch, groupByDate, looksLikeCode, normalizeCode,
  normalizeFound, normalizeReservation, normalizeText, whenLabel,
} from '../src/features/admin/upcomingView.js'

const TZ = 'America/Sao_Paulo'

test('codigo curto e igual ao que o cliente recebe (8 primeiros caracteres)', () => {
  const id = 'abcdef12-3456-7890-abcd-ef1234567890'
  assert.equal(shortCode(id), 'ABCDEF12')
  assert.equal(shortCode(id), String(id).slice(0, 8).toUpperCase())
  assert.equal(shortCode(null), '')
})

test('normaliza o codigo digitado', () => {
  assert.equal(normalizeCode(' AB12-cd34 '), 'ab12cd34')
  assert.equal(normalizeCode('xyz!'), '')
  assert.equal(normalizeCode(undefined), '')
})

test('normaliza reservas dos tres tipos', () => {
  const booking = normalizeReservation('booking', {
    id: 'aaaa1111-0000-0000-0000-000000000000', status: 'confirmed', pet_name: 'Lilica', pet_breed: 'Poodle', service_name: 'Banho',
    size_label: 'Pequeno', customer_name: 'Gabriel', customer_phone: '41999990000', price_cents: 8000,
    starts_at: '2026-10-29T11:00:00Z', ends_at: '2026-10-29T13:00:00Z', notes: 'Alergica',
  }, TZ)
  assert.equal(booking.ymd, '2026-10-29')
  assert.equal(booking.whenLabel, '08:00–10:00')
  assert.equal(booking.code, 'AAAA1111')
  assert.equal(booking.petBreed, 'Poodle')
  assert.equal(booking.baseCents, 8000)
  // 23h30 em Sao Paulo ainda e o mesmo dia local (em UTC ja e o dia seguinte)
  const late = normalizeReservation('booking', { id: 'b', status: 'confirmed', starts_at: '2026-10-30T02:30:00Z', ends_at: '2026-10-30T03:30:00Z' }, TZ)
  assert.equal(late.ymd, '2026-10-29')
  const daycare = normalizeReservation('daycare', {
    id: 'cccc', status: 'confirmed', period: 'afternoon', starts_at: '2026-10-30T16:00:00Z', ends_at: '2026-10-30T21:00:00Z', price_cents: 3000,
  }, TZ)
  assert.equal(daycare.whenLabel, 'Tarde · 13:00–18:00')
  const stay = normalizeReservation('stay', {
    id: 'dddd', status: 'confirmed', check_in: '2026-10-25', check_out: '2026-10-27', total_price_cents: 10000,
  }, TZ)
  assert.equal(stay.ymd, '2026-10-25')
  assert.equal(stay.whenLabel, '25/10 → 27/10')
  assert.equal(stay.baseCents, 10000)
  assert.equal(whenLabel('stay', {
    check_in: '2026-10-25', check_out: '2026-10-27', check_in_at: '2026-10-25T11:00:00Z', check_out_at: '2026-10-27T23:00:00Z',
  }, TZ), '25/10 08:00 → 27/10 20:00')
})

test('item da busca por codigo mostra a data', () => {
  const found = normalizeFound({
    kind: 'booking', id: 'aaaa1119-0000-0000-0000-000000000009', status: 'cancelled', customer_name: 'Ana', customer_phone: '41966665555',
    pet_name: 'Zeca', pet_breed: 'Pug', service_name: 'Banho', size_label: 'Pequeno', price_cents: 5000,
    starts_at: '2026-10-19T13:00:00Z', ends_at: '2026-10-19T14:00:00Z',
  }, TZ)
  assert.equal(found.whenLabel, '19/10 · 10:00–11:00')
  assert.equal(found.code, 'AAAA1119')
  const stay = normalizeFound({
    kind: 'stay', id: 'dddd', status: 'confirmed', starts_at: '2026-10-25T11:00:00Z', ends_at: '2026-10-27T23:00:00Z', price_cents: 1,
  }, TZ)
  assert.equal(stay.whenLabel, '25/10 08:00 → 27/10 20:00')
})

test('agrupa por data e ordena por horario', () => {
  const items = [
    { id: '1', ymd: '2026-10-30', startIso: '2026-10-30T13:00:00Z' },
    { id: '2', ymd: '2026-10-29', startIso: '2026-10-29T15:00:00Z' },
    { id: '3', ymd: '2026-10-29', startIso: '2026-10-29T11:00:00Z' },
  ]
  const groups = groupByDate(items)
  assert.deepEqual(groups.map(([ymd]) => ymd), ['2026-10-29', '2026-10-30'])
  assert.deepEqual(groups[0][1].map((i) => i.id), ['3', '2'])
})

test('titulo da data', () => {
  assert.ok(dateHeading('2026-10-29', '2026-10-29').startsWith('Hoje · Quinta-feira'))
  assert.ok(dateHeading('2026-10-30', '2026-10-29').startsWith('Amanhã · Sexta-feira'))
  assert.ok(dateHeading('2026-11-02', '2026-10-29').startsWith('Segunda-feira'))
  assert.ok(!dateHeading('2026-11-02', '2026-10-29').includes('·'))
})

test('filtra por codigo (minimo de 4 caracteres)', () => {
  const items = [
    { id: 'abcdef12-0000-0000-0000-000000000000' },
    { id: 'abcd9999-0000-0000-0000-000000000000' },
    { id: 'ffff0000-0000-0000-0000-000000000000' },
  ]
  assert.equal(filterByCode(items, 'ABCDEF12').length, 1)
  assert.equal(filterByCode(items, 'abcd').length, 2) // mais de um com o mesmo inicio: todos aparecem
  assert.equal(filterByCode(items, 'abc').length, 0) // curto demais
  assert.equal(filterByCode(items, 'abcd-ef12').length, 1)
  assert.equal(filterByCode(items, 'zzzz').length, 0)
})

test('valida consultas por nome ou codigo', () => {
  assert.equal(canSearch(' Ana '), true)
  assert.equal(canSearch('joao'), true)
  assert.equal(canSearch('a'), false)
  assert.equal(canSearch('a'.repeat(81)), false)
  assert.equal(looksLikeCode('AB12-cd34'), true)
  assert.equal(looksLikeCode('joao costa'), false)
  assert.equal(normalizeText('  João   PÊRA '), 'joao pera')
})

test('filtra localmente por codigo, tutor e pet sem diferenciar acentos ou caixa', () => {
  const items = [
    { id: 'abcdef12-0000-0000-0000-000000000000', customerName: 'João Pêra', petName: 'Pérola' },
    { id: '12345678-0000-0000-0000-000000000000', customerName: 'Ana Costa', petName: 'Rex' },
  ]
  assert.deepEqual(filterBySearch(items, 'joao'), [items[0]])
  assert.deepEqual(filterBySearch(items, 'PEROLA'), [items[0]])
  assert.deepEqual(filterBySearch(items, '1234'), [items[1]])
  assert.deepEqual(filterBySearch(items, 'a'), [])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { bookingDetails, canCancelBooking, dateRangeInTimezone, dateInTimezone } from '../src/features/admin/bookingView.js'

const booking = {
  service_name: 'Banho original',
  size: 'small',
  starts_at: '2026-10-23T13:00:00.000Z',
  ends_at: '2026-10-23T13:45:00.000Z',
  duration_minutes: 45,
  buffer_minutes: 10,
  price_cents: 6000,
  status: 'confirmed',
}

test('detalhes usam somente snapshots do agendamento, nao configuracoes do servico', () => {
  assert.deepEqual(bookingDetails(booking, 'America/Sao_Paulo'), {
    service: 'Banho original',
    size: 'Pequeno',
    date: 'sexta-feira, 23 de outubro',
    start: '10:00',
    end: '10:45',
    duration: '45 min',
    price: 'R$ 60,00',
    status: 'Confirmado',
  })
})

test('intervalo de dia respeita meia-noite no fuso do negocio', () => {
  const range = dateRangeInTimezone('2026-10-23', 'America/Sao_Paulo')
  assert.equal(range.start, '2026-10-23T03:00:00.000Z')
  assert.equal(range.end, '2026-10-24T03:00:00.000Z')
  assert.equal(dateInTimezone('2026-10-23T02:59:59.000Z', 'America/Sao_Paulo'), '2026-10-22')
})

test('apenas agendamentos confirmados podem ser cancelados', () => {
  assert.equal(canCancelBooking('confirmed'), true)
  assert.equal(canCancelBooking('cancelled'), false)
  assert.equal(canCancelBooking('completed'), false)
  assert.equal(canCancelBooking('no_show'), false)
})

test('porte personalizado usa snapshot do agendamento em vez do nome atual no catalogo', () => {
  assert.equal(bookingDetails({ ...booking, size: 'extra-grande-abc123', size_label: 'Gigante' }, 'America/Sao_Paulo').size, 'Gigante')
})

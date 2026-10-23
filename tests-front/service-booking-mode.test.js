import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isDailyService,
  normalizeBookingMode,
  resolveDurationMinutes,
} from '../src/features/admin/serviceCatalog.js'

test('modo desconhecido ou ausente vale como por horario', () => {
  assert.equal(normalizeBookingMode('daily'), 'daily')
  assert.equal(normalizeBookingMode('hourly'), 'hourly')
  assert.equal(normalizeBookingMode(undefined), 'hourly')
  assert.equal(normalizeBookingMode(null), 'hourly')
  assert.equal(normalizeBookingMode('weekly'), 'hourly')
})

test('identifica servico por diaria', () => {
  assert.equal(isDailyService({ booking_mode: 'daily' }), true)
  assert.equal(isDailyService({ booking_mode: 'hourly' }), false)
  assert.equal(isDailyService({}), false)
  assert.equal(isDailyService(undefined), false)
})

test('duracao por horario e obrigatoria e limitada a 5-720 minutos', () => {
  assert.equal(resolveDurationMinutes('hourly', '45'), 45)
  assert.equal(resolveDurationMinutes('hourly', 90), 90)
  assert.equal(resolveDurationMinutes('hourly', '4'), null)
  assert.equal(resolveDurationMinutes('hourly', '721'), null)
  assert.equal(resolveDurationMinutes('hourly', '1.5'), null)
  assert.equal(resolveDurationMinutes('hourly', ''), null)
})

test('duracao por diaria nunca bloqueia o salvamento', () => {
  assert.equal(resolveDurationMinutes('daily', '120'), 120)
  assert.equal(resolveDurationMinutes('daily', ''), 30)
  assert.equal(resolveDurationMinutes('daily', 'abc'), 30)
  assert.equal(resolveDurationMinutes('daily', '9999'), 30)
})

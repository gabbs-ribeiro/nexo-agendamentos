import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isValidPeriodSettings,
  isDailyService,
  normalizeBookingMode,
  parseTimeOptions,
  resolveDurationMinutes,
} from '../src/features/admin/serviceCatalog.js'

test('normaliza modelos conhecidos e mantem horario para modelos ausentes', () => {
  assert.equal(normalizeBookingMode('daily'), 'daily')
  assert.equal(normalizeBookingMode('hourly'), 'hourly')
  assert.equal(normalizeBookingMode('periods'), 'periods')
  assert.equal(normalizeBookingMode('stay'), 'stay')
  assert.equal(normalizeBookingMode(undefined), 'hourly')
  assert.equal(normalizeBookingMode(null), 'hourly')
  assert.equal(normalizeBookingMode('weekly'), 'hourly')
})

test('identifica servico por diaria', () => {
  assert.equal(isDailyService({ booking_mode: 'daily' }), true)
  assert.equal(isDailyService({ booking_mode: 'stay' }), true)
  assert.equal(isDailyService({ booking_mode: 'periods' }), false)
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
  assert.equal(resolveDurationMinutes('periods', ''), 30)
  assert.equal(resolveDurationMinutes('stay', ''), 30)
})

test('valida horários de período em ordem e sem sobreposição', () => {
  assert.equal(isValidPeriodSettings({
    morning_start: '08:00',
    morning_end: '13:00',
    afternoon_start: '13:00',
    afternoon_end: '18:00',
  }), true)
  assert.equal(isValidPeriodSettings({
    morning_start: '08:00',
    morning_end: '14:00',
    afternoon_start: '13:00',
    afternoon_end: '18:00',
  }), false)
})

test('converte opções de horário em lista única no formato HH:MM', () => {
  assert.deepEqual(parseTimeOptions('08:00, 20:30'), ['08:00', '20:30'])
  assert.equal(parseTimeOptions('08:00,08:00'), null)
  assert.equal(parseTimeOptions('25:00'), null)
  assert.equal(parseTimeOptions(''), null)
})

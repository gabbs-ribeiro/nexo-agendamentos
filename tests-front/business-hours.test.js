import test from 'node:test'
import assert from 'node:assert/strict'
import { businessHoursDraft, businessHoursPayload, timeForMinute, WEEKDAYS } from '../src/features/admin/businessHours.js'

test('expediente converte minutos do banco em horários locais editáveis', () => {
  const draft = businessHoursDraft([
    { id: 'morning', day_of_week: 1, opens_minute: 480, closes_minute: 720 },
    { id: 'afternoon', day_of_week: 1, opens_minute: 780, closes_minute: 1440 },
  ])
  assert.deepEqual(draft[1], [
    { id: 'morning', opens_at: '08:00', closes_at: '12:00' },
    { id: 'afternoon', opens_at: '13:00', closes_at: '00:00' },
  ])
  assert.equal(timeForMinute(1439), '23:59')
})

test('payload preserva vários intervalos por dia e o índice domingo-zero do banco', () => {
  const payload = businessHoursPayload({
    0: [{ opens_at: '09:15', closes_at: '12:30' }],
    1: [
      { opens_at: '13:00', closes_at: '17:00' },
      { opens_at: '08:00', closes_at: '12:00' },
    ],
    2: [{ opens_at: '22:00', closes_at: '00:00' }],
  })
  assert.deepEqual(payload, [
    { day_of_week: 1, opens_minute: 480, closes_minute: 720 },
    { day_of_week: 1, opens_minute: 780, closes_minute: 1020 },
    { day_of_week: 2, opens_minute: 1320, closes_minute: 1440 },
    { day_of_week: 0, opens_minute: 555, closes_minute: 750 },
  ])
  assert.equal(WEEKDAYS[WEEKDAYS.length - 1].value, 0)
})

test('00:00 como fechamento representa o fim do dia', () => {
  assert.deepEqual(businessHoursPayload({
    1: [{ opens_at: '08:00', closes_at: '00:00' }],
  }), [
    { day_of_week: 1, opens_minute: 480, closes_minute: 1440 },
  ])
})

test('expediente rejeita faixas vazias, invertidas ou sobrepostas', () => {
  assert.throws(() => businessHoursPayload({ 1: [{ opens_at: '', closes_at: '12:00' }] }), /INVALID_HOURS/)
  assert.throws(() => businessHoursPayload({ 1: [{ opens_at: '13:00', closes_at: '12:00' }] }), /INVALID_HOURS/)
  assert.throws(() => businessHoursPayload({ 1: [
    { opens_at: '08:00', closes_at: '12:00' },
    { opens_at: '11:59', closes_at: '14:00' },
  ] }), /INVALID_HOURS/)
})

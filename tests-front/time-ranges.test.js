import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTimeRange, timeOptionsInRange } from '../src/lib/timeRanges.js'

test('gera horários a cada 30 minutos, incluindo os limites do intervalo', () => {
  assert.deepEqual(timeOptionsInRange('08:00', '09:00'), ['08:00', '08:30', '09:00'])
  assert.deepEqual(timeOptionsInRange('08:30', '08:30'), ['08:30'])
  assert.deepEqual(timeOptionsInRange('08:00:00', '09:00:00'), ['08:00', '08:30', '09:00'])
  assert.deepEqual(timeOptionsInRange('08:15', '09:15'), ['08:15', '08:45', '09:15'])
})

test('recusa intervalos inválidos e mantém o passo de 30 minutos ancorado no início', () => {
  assert.equal(parseTimeRange('10:00', '09:00'), null)
  assert.equal(parseTimeRange('08:00x', '09:00'), null)
  assert.deepEqual(timeOptionsInRange('', '09:00'), [])
})

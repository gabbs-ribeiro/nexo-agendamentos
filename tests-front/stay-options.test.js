import test from 'node:test'
import assert from 'node:assert/strict'
import { hasNoFurtherStayOptionThatDay } from '../src/features/public-booking/stayOptions.js'

const option = (date, time, instant) => ({
  check_out: date,
  check_out_time: time,
  check_out_at: instant,
})

test('só indica o fim do dia após selecionar uma saída que não pode estender mais 12 horas nele', () => {
  const options = [
    option('2026-10-24', '08:00', '2026-10-24T11:00:00Z'),
    option('2026-10-24', '20:00', '2026-10-24T23:00:00Z'),
    option('2026-10-25', '08:00', '2026-10-25T11:00:00Z'),
  ]

  assert.equal(hasNoFurtherStayOptionThatDay(options, options[0]), false)
  assert.equal(hasNoFurtherStayOptionThatDay(options, options[1]), true)
})

test('não indica fim do dia quando ainda não há uma saída selecionada', () => {
  const options = [
    option('2026-10-24', '08:00', '2026-10-24T11:00:00Z'),
    option('2026-10-24', '20:00', '2026-10-24T23:00:00Z'),
  ]

  assert.equal(hasNoFurtherStayOptionThatDay(options, undefined), false)
})

test('não mostra aviso para datas sem opções de saída', () => {
  assert.equal(hasNoFurtherStayOptionThatDay([], null), false)
})

import {
  chargeUnitsLabel, daysBetween, exitCandidatesForDate, exitDatesFor, exitStatus, isOutsideWindow,
} from '../src/features/public-booking/stayOptions.js'
import { minutesNowInTz, timeToMinutes } from '../src/lib/timeRanges.js'

test('conta dias entre datas', () => {
  assert.equal(daysBetween('2026-10-23', '2026-10-26'), 3)
  assert.equal(daysBetween('2026-10-30', '2026-11-02'), 3)
  assert.equal(daysBetween('2026-10-23', '2026-10-23'), 0)
  assert.equal(daysBetween('2026-10-23', '2026-10-22'), -1)
})

test('cada data de saida tem o mesmo horario da entrada e 12 h antes/depois', () => {
  // entrada 08:00 -> no dia 2: 08:00 (4 blocos = 2 diarias) e 20:00 (5 blocos = 2,5 diarias)
  const d2 = exitCandidatesForDate({ checkIn: '2026-10-23', entryTime: '08:00', exitDate: '2026-10-25' })
  assert.deepEqual(d2.map((c) => [c.time, c.units, c.relation]), [['08:00', 2, 'same'], ['20:00', 2.5, 'after']])
  // entrada 15:00 -> no dia 1: 03:00 (12 h antes) e 15:00 (mesmo horario)
  const d1 = exitCandidatesForDate({ checkIn: '2026-10-23', entryTime: '15:00', exitDate: '2026-10-24' })
  assert.deepEqual(d1.map((c) => [c.time, c.units, c.relation]), [['03:00', 0.5, 'before'], ['15:00', 1, 'same']])
})

test('saida no proprio dia so existe quando entrada + 12 h ainda cai no dia', () => {
  const morning = exitCandidatesForDate({ checkIn: '2026-10-23', entryTime: '08:00', exitDate: '2026-10-23' })
  assert.deepEqual(morning.map((c) => c.time), ['20:00'])
  assert.deepEqual(exitCandidatesForDate({ checkIn: '2026-10-23', entryTime: '15:00', exitDate: '2026-10-23' }), [])
  assert.deepEqual(exitCandidatesForDate({ checkIn: '2026-10-23', entryTime: '08:00', exitDate: '2026-10-22' }), [])
  assert.deepEqual(exitCandidatesForDate({ checkIn: '2026-10-23', entryTime: '08:00', exitDate: '2026-11-23' }), [])
  assert.deepEqual(exitCandidatesForDate({ checkIn: '', entryTime: '08:00', exitDate: '2026-10-23' }), [])
})

test('datas de saida oferecidas: sem a data da entrada quando a entrada e a partir do meio-dia', () => {
  const afternoon = exitDatesFor({ checkIn: '2026-10-23', entryTime: '15:00' })
  assert.equal(afternoon[0], '2026-10-24')
  assert.equal(afternoon.length, 30)
  const morning = exitDatesFor({ checkIn: '2026-10-23', entryTime: '08:00' })
  assert.equal(morning[0], '2026-10-23')
  assert.equal(morning.length, 31)
  assert.equal(morning.at(-1), '2026-11-22')
  assert.deepEqual(exitDatesFor({ checkIn: '2026-10-23', entryTime: '' }), [])
})

test('associa candidatos as opcoes do banco e marca o que ultrapassa a janela de retirada', () => {
  const window = { start: '07:00:00', end: '22:00:00' }
  const options = [
    { check_out: '2026-10-24', check_out_time: '15:00', available: true },
  ]
  const [before, same] = exitCandidatesForDate({ checkIn: '2026-10-23', entryTime: '15:00', exitDate: '2026-10-24', options })
  assert.equal(exitStatus(before, window), 'outside') // 03:00 < 07:00 e o banco nao devolve
  assert.equal(exitStatus(same, window), 'available')
  const full = { time: '10:00', option: { available: false } }
  assert.equal(exitStatus(full, window), 'full')
  assert.equal(exitStatus({ time: '10:00', option: null }, window), 'unavailable')
  assert.equal(isOutsideWindow('22:30', '07:00:00', '22:00:00'), true)
  assert.equal(isOutsideWindow('22:00', '07:00:00', '22:00:00'), false)
  assert.equal(isOutsideWindow('07:00', '07:00:00', '22:00:00'), false)
  assert.equal(isOutsideWindow('06:30', '07:00:00', '22:00:00'), true)
})

test('rotulo de diarias cobradas', () => {
  assert.equal(chargeUnitsLabel(0.5), '0,5 diária')
  assert.equal(chargeUnitsLabel(1), '1 diária')
  assert.equal(chargeUnitsLabel(2.5), '2,5 diárias')
  assert.equal(chargeUnitsLabel(3), '3 diárias')
})

test('minutos de agora no fuso do negocio', () => {
  assert.equal(minutesNowInTz('America/Sao_Paulo', new Date('2026-10-23T15:30:00Z')), 12 * 60 + 30)
  assert.equal(minutesNowInTz('America/Sao_Paulo', new Date('2026-10-23T02:05:00Z')), 23 * 60 + 5) // dia anterior
  assert.equal(timeToMinutes('07:30'), 450)
})

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

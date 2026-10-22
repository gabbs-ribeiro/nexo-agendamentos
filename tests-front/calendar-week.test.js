import test from 'node:test'
import assert from 'node:assert/strict'
import { capitalizeFirst, weekDays, weekMonthTitle, weekStartYmd } from '../src/features/admin/calendarWeek.js'

test('a semana começa na segunda-feira', () => {
  assert.equal(weekStartYmd('2026-10-22'), '2026-10-19') // quinta
  assert.equal(weekStartYmd('2026-10-19'), '2026-10-19') // segunda
  assert.equal(weekStartYmd('2026-10-25'), '2026-10-19') // domingo pertence à semana que termina nele
})

test('weekDays devolve 7 dias seguidos, mesmo virando o mês ou o ano', () => {
  assert.deepEqual(weekDays('2026-10-29'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
  assert.deepEqual(weekDays('2026-12-31').at(-1), '2027-01-03')
})

test('a posição do dia na semana não muda ao navegar de 7 em 7 dias', () => {
  const a = weekDays('2026-10-22')
  const b = weekDays('2026-10-29')
  assert.equal(a.indexOf('2026-10-22'), b.indexOf('2026-10-29'))
})

test('título do mês da semana', () => {
  assert.equal(weekMonthTitle(weekDays('2026-10-22')), 'Outubro de 2026')
  assert.equal(weekMonthTitle(weekDays('2026-10-29')), 'Outubro / Novembro de 2026')
  assert.equal(weekMonthTitle(weekDays('2026-12-31')), 'Dezembro 2026 / Janeiro 2027')
})

test('capitalizeFirst só põe a primeira letra em maiúscula', () => {
  assert.equal(capitalizeFirst('quinta-feira, 22 de outubro'), 'Quinta-feira, 22 de outubro')
  assert.equal(capitalizeFirst(''), '')
})

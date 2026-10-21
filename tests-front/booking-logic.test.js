import test from 'node:test'
import assert from 'node:assert/strict'
import { reducer, initialState, STEPS } from '../src/features/public-booking/bookingReducer.js'
import { validateDetails } from '../src/features/public-booking/validation.js'
import { whatsappUrl } from '../src/lib/format.js'

const slotA = { starts_at: '2026-10-23T13:00:00+00:00', local_time: '10:00' }

test('passos na ordem esperada', () => {
  assert.deepEqual(STEPS, ['service', 'datetime', 'details'])
})

test('escolher horario gera uma chave de idempotencia nova a cada escolha', () => {
  const s1 = reducer(initialState, { type: 'slot', slot: slotA })
  const s2 = reducer(s1, { type: 'slot', slot: slotA })
  assert.ok(s1.key && s2.key)
  assert.notEqual(s1.key, s2.key)
})

test('trocar servico/porte invalida data, horario e chave (duracao muda)', () => {
  let s = reducer(initialState, { type: 'option', optionId: 'o1' })
  s = reducer(s, { type: 'date', date: '2026-10-23' })
  s = reducer(s, { type: 'slot', slot: slotA })
  s = reducer(s, { type: 'option', optionId: 'o2' })
  assert.equal(s.optionId, 'o2')
  assert.equal(s.date, null)
  assert.equal(s.slot, null)
  assert.equal(s.key, null)
})

test('trocar o dia limpa o horario escolhido', () => {
  let s = reducer(initialState, { type: 'slot', slot: slotA })
  s = reducer(s, { type: 'date', date: '2026-10-24' })
  assert.equal(s.slot, null)
  assert.equal(s.date, '2026-10-24')
})

test('horario ocupado por outra pessoa: volta ao passo de horario, mantem dados e avisa', () => {
  let s = reducer(initialState, { type: 'option', optionId: 'o1' })
  s = reducer(s, { type: 'date', date: '2026-10-23' })
  s = reducer(s, { type: 'slot', slot: slotA })
  s = reducer(s, { type: 'field', name: 'name', value: 'Maria Silva' })
  s = reducer(s, { type: 'step', step: 'details' })
  s = reducer(s, { type: 'slot_taken', notice: 'Esse horario acabou de ser ocupado.' })
  assert.equal(s.step, 'datetime')
  assert.equal(s.slot, null)
  assert.equal(s.key, null)
  assert.equal(s.optionId, 'o1')
  assert.equal(s.date, '2026-10-23')
  assert.equal(s.form.name, 'Maria Silva')
  assert.match(s.notice, /ocupado/)
})

test('o estado inicial nao e mutado', () => {
  const copy = JSON.stringify(initialState)
  reducer(initialState, { type: 'field', name: 'name', value: 'x' })
  reducer(initialState, { type: 'option', optionId: 'o1' })
  assert.equal(JSON.stringify(initialState), copy)
})

test('validacao dos dados do cliente', () => {
  const ok = { name: 'Maria Silva', phone: '(41) 99999-0001', petName: 'Rex', petBreed: '', notes: '', consent: true }
  assert.deepEqual(validateDetails(ok), {})
  assert.ok(validateDetails({ ...ok, name: 'M' }).name)
  assert.ok(validateDetails({ ...ok, phone: '123' }).phone)
  assert.ok(validateDetails({ ...ok, petName: '   ' }).petName)
  assert.ok(validateDetails({ ...ok, consent: false }).consent)
  assert.ok(validateDetails({ ...ok, notes: 'x'.repeat(501) }).notes)
  assert.equal(Object.keys(validateDetails({ name: '', phone: '', petName: '', petBreed: '', notes: '', consent: false })).length, 4)
})

test('link do WhatsApp so com telefone valido', () => {
  assert.equal(whatsappUrl('(41) 99999-0001'), 'https://wa.me/5541999990001')
  assert.equal(whatsappUrl(null), null)
  assert.equal(whatsappUrl('123'), null)
})

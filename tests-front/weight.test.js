import test from 'node:test'
import assert from 'node:assert/strict'
import { findWeightOverlaps, parseWeightInput, weightRangeError, weightRangeLabel } from '../src/lib/weight.js'

test('le o peso digitado', () => {
  assert.deepEqual(parseWeightInput('5'), { ok: true, value: 5 })
  assert.deepEqual(parseWeightInput('7,5'), { ok: true, value: 7.5 })
  assert.deepEqual(parseWeightInput(' 12.34 '), { ok: true, value: 12.3 })
  assert.deepEqual(parseWeightInput(''), { ok: true, value: null })
  assert.deepEqual(parseWeightInput('   '), { ok: true, value: null })
  assert.equal(parseWeightInput('abc').ok, false)
  assert.equal(parseWeightInput('-3').ok, false)
  assert.equal(parseWeightInput('1000').ok, false)
  assert.deepEqual(parseWeightInput('0'), { ok: true, value: 0 })
})

test('valida minimo e maximo', () => {
  assert.equal(weightRangeError(5, 10), '')
  assert.equal(weightRangeError(null, 10), '')
  assert.equal(weightRangeError(25, null), '')
  assert.equal(weightRangeError(null, null), '')
  assert.equal(weightRangeError(10, 10), '')
  assert.ok(weightRangeError(10, 5).includes('não pode ser menor'))
  assert.ok(weightRangeError(null, 0).includes('maior que zero'))
})

test('texto da faixa para o cliente', () => {
  assert.equal(weightRangeLabel(5, 10), '5 a 10 kg')
  assert.equal(weightRangeLabel('5.0', '10.5'), '5 a 10,5 kg')
  assert.equal(weightRangeLabel(null, 10), 'até 10 kg')
  assert.equal(weightRangeLabel(25, null), 'a partir de 25 kg')
  assert.equal(weightRangeLabel(0, 5), '0 a 5 kg')
  assert.equal(weightRangeLabel(8, 8), '8 kg')
  assert.equal(weightRangeLabel(null, null), '')
  assert.equal(weightRangeLabel(undefined, undefined), '')
})

test('detecta faixas que se sobrepoem', () => {
  const sizes = [
    { name: 'Pequeno', weight_min_kg: null, weight_max_kg: 10, is_active: true },
    { name: 'Médio', weight_min_kg: 10, weight_max_kg: 25, is_active: true },
    { name: 'Grande', weight_min_kg: 25, weight_max_kg: null, is_active: true },
  ]
  assert.deepEqual(findWeightOverlaps(sizes), [])
  const bad = [...sizes.slice(0, 1), { name: 'Médio', weight_min_kg: 8, weight_max_kg: 25, is_active: true }]
  assert.deepEqual(findWeightOverlaps(bad), [['Pequeno', 'Médio']])
  // porte desativado e porte sem faixa nao entram na conta
  assert.deepEqual(findWeightOverlaps([...bad, { name: 'Gigante', weight_min_kg: 1, weight_max_kg: 99, is_active: false }, { name: 'X', weight_min_kg: null, weight_max_kg: null }]), [['Pequeno', 'Médio']])
})

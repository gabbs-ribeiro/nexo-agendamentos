import test from 'node:test'
import assert from 'node:assert/strict'
import { countLabel } from '../src/features/admin/controlSummary.js'

test('contagem usa singular so quando e exatamente 1', () => {
  assert.equal(countLabel(0, 'serviço ativo', 'serviços ativos'), '0 serviços ativos')
  assert.equal(countLabel(1, 'serviço ativo', 'serviços ativos'), '1 serviço ativo')
  assert.equal(countLabel(2, 'serviço ativo', 'serviços ativos'), '2 serviços ativos')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { groupServicesByCategory } from '../src/features/admin/catalogCategories.js'

test('mantem categorias vazias e associa servicos somente a sua categoria', () => {
  const categories = [
    { id: 'bath', name: 'Banho e tosa' },
    { id: 'hotel', name: 'Pet Hotel / creche' },
  ]
  const services = [
    { id: 'bath-only', category_id: 'bath' },
    { id: 'bath-grooming', category_id: 'bath' },
  ]

  assert.deepEqual(groupServicesByCategory(categories, services), [
    { id: 'bath', name: 'Banho e tosa', services: services },
    { id: 'hotel', name: 'Pet Hotel / creche', services: [] },
  ])
})

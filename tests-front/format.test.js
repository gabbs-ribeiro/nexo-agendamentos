import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatBRL, formatDuration, todayInTz, addDaysYmd, bookableDays, dayChipParts,
  formatLongDate, formatInstant, maskPhone, nationalDigits, isValidPhone,
  readableOn, brandOrDefault, newIdempotencyKey,
} from '../src/lib/format.js'
import { ApiError, messageFor, ERROR_MESSAGES } from '../src/lib/errors.js'

const nbsp = (s) => s.replace(/\u00a0/g, ' ')

test('preco em reais a partir de centavos', () => {
  assert.equal(nbsp(formatBRL(6000)), 'R$ 60,00')
  assert.equal(nbsp(formatBRL(12550)), 'R$ 125,50')
  assert.equal(nbsp(formatBRL(0)), 'R$ 0,00')
})

test('duracao legivel, sem arredondar', () => {
  assert.equal(formatDuration(45), '45 min')
  assert.equal(formatDuration(60), '1 h')
  assert.equal(formatDuration(75), '1 h 15 min')
})

test('hoje depende do fuso do NEGOCIO, nao do navegador', () => {
  // 2026-10-21 02:30 UTC ainda e dia 20 em Sao Paulo (UTC-3) e ja e dia 21 em Toquio
  const now = new Date('2026-10-21T02:30:00Z')
  assert.equal(todayInTz('America/Sao_Paulo', now), '2026-10-20')
  assert.equal(todayInTz('Asia/Tokyo', now), '2026-10-21')
  assert.equal(todayInTz('UTC', now), '2026-10-21')
})

test('soma de dias respeita virada de mes e ano', () => {
  assert.equal(addDaysYmd('2026-10-31', 1), '2026-11-01')
  assert.equal(addDaysYmd('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysYmd('2028-02-28', 1), '2028-02-29')
  assert.equal(addDaysYmd('2026-03-01', -1), '2026-02-28')
})

test('dias oferecidos: hoje ate hoje + limite do negocio', () => {
  const days = bookableDays('America/Sao_Paulo', 30, new Date('2026-10-20T15:00:00Z'))
  assert.equal(days.length, 31)
  assert.equal(days[0], '2026-10-20')
  assert.equal(days[30], '2026-11-19')
})

test('rotulos de dia e data longa independem do fuso da maquina', () => {
  assert.deepEqual(dayChipParts('2026-10-21'), { weekday: 'qua', day: '21', month: 'out' })
  assert.equal(formatLongDate('2026-10-21'), 'quarta-feira, 21 de outubro')
})

test('instante exibido no fuso do negocio', () => {
  // 13:00Z = 10:00 em Sao Paulo
  assert.deepEqual(formatInstant('2026-10-23T13:00:00Z', 'America/Sao_Paulo'),
    { date: 'sexta-feira, 23 de outubro', time: '10:00' })
  // 02:30Z do dia 24 ainda e noite do dia 23 em Sao Paulo
  assert.equal(formatInstant('2026-10-24T02:30:00Z', 'America/Sao_Paulo').date, 'sexta-feira, 23 de outubro')
})

test('mascara e validacao de telefone (iguais as regras do banco)', () => {
  assert.equal(maskPhone('41999990001'), '(41) 99999-0001')
  assert.equal(maskPhone('4132221234'), '(41) 3222-1234')
  assert.equal(maskPhone('419'), '(41) 9')
  assert.equal(maskPhone('4'), '(4')
  assert.equal(maskPhone(''), '')
  assert.equal(maskPhone('+55 (41) 99999-0001'), '(41) 99999-0001')
  assert.equal(nationalDigits('5541999990001'), '41999990001')
  assert.equal(nationalDigits('55991234567'), '55991234567') // 11 digitos com DDD 55: NAO remove
  assert.equal(isValidPhone('(41) 99999-0001'), true)
  assert.equal(isValidPhone('123'), false)
  assert.equal(isValidPhone('419999900011'), false)
})

test('cor da marca: texto com contraste suficiente e fallback', () => {
  assert.equal(readableOn('#FFFF00'), '#14201F') // amarelo -> texto escuro
  assert.equal(readableOn('#1E3A8A'), '#FFFFFF') // azul escuro -> texto claro
  assert.equal(brandOrDefault('azul'), '#2563eb')
  assert.equal(brandOrDefault('#AABBCC'), '#AABBCC')
  assert.equal(readableOn(null), '#FFFFFF')
})

test('chave de idempotencia e um UUID v4', () => {
  const k = newIdempotencyKey()
  assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(k, newIdempotencyKey())
})

test('erros: codigo conhecido vira mensagem; desconhecido nunca vaza texto bruto', () => {
  assert.equal(messageFor(new ApiError('SLOT_UNAVAILABLE')), ERROR_MESSAGES.SLOT_UNAVAILABLE)
  assert.equal(new ApiError('ALGO_ESTRANHO: detalhe do banco').code, 'UNKNOWN')
  assert.equal(messageFor(new Error('duplicate key value violates unique constraint "x"')), ERROR_MESSAGES.UNKNOWN)
  for (const m of Object.values(ERROR_MESSAGES)) assert.ok(m.length > 10)
})

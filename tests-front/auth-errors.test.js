import test from 'node:test'
import assert from 'node:assert/strict'
import { ERROR_MESSAGES, messageForAuthError } from '../src/lib/errors.js'

test('credenciais incorretas recebem mensagem compreensivel sem erro tecnico', () => {
  assert.equal(
    messageForAuthError({ code: 'invalid_credentials', message: 'raw database detail' }),
    ERROR_MESSAGES.AUTH_INVALID_CREDENTIALS,
  )
})

test('e-mail nao confirmado recebe orientacao sem expor resposta do Auth', () => {
  assert.equal(
    messageForAuthError({ code: 'email_not_confirmed', message: 'technical response' }),
    ERROR_MESSAGES.AUTH_UNCONFIRMED,
  )
})

test('erros Auth desconhecidos nao sao exibidos em texto bruto', () => {
  assert.equal(
    messageForAuthError({ code: 'unexpected', message: 'sensitive internal detail' }),
    ERROR_MESSAGES.AUTH_GENERIC,
  )
})

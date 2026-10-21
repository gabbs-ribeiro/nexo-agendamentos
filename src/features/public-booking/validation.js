import { isValidPhone } from '../../lib/format.js'

/** Validacao de conveniencia no navegador. A validacao que vale e a do banco. */
export function validateDetails(form) {
  const e = {}
  if (form.name.trim().length < 2) e.name = 'Informe seu nome.'
  else if (form.name.trim().length > 100) e.name = 'Use no máximo 100 caracteres.'
  if (!isValidPhone(form.phone)) e.phone = 'Informe um telefone com DDD.'
  if (form.petName.trim().length < 1) e.petName = 'Informe o nome do pet.'
  else if (form.petName.trim().length > 60) e.petName = 'Use no máximo 60 caracteres.'
  if (form.petBreed.trim().length > 60) e.petBreed = 'Use no máximo 60 caracteres.'
  if (form.notes.trim().length > 500) e.notes = 'Use no máximo 500 caracteres.'
  if (form.consent !== true) e.consent = 'Aceite o aviso de privacidade para continuar.'
  return e
}

import { newIdempotencyKey } from '../../lib/format.js'

export const STEPS = ['service', 'datetime', 'details']

export const initialForm = { name: '', phone: '', petName: '', petBreed: '', notes: '', consent: false }

export const initialState = {
  step: 'service',
  optionId: null,
  date: null,
  slot: null,      // { starts_at, local_time } exatamente como o banco devolveu
  key: null,       // chave de idempotencia da tentativa de confirmacao
  notice: null,    // aviso exibido ao voltar para a escolha de horario
  form: initialForm,
}

export function reducer(state, action) {
  switch (action.type) {
    case 'option':   // trocar servico/porte invalida data e horario (duracao diferente)
      return { ...state, optionId: action.optionId, date: null, slot: null, key: null, notice: null }
    case 'date':
      return { ...state, date: action.date, slot: null, key: null, notice: null }
    case 'slot':     // novo horario = nova tentativa = nova chave
      return { ...state, slot: action.slot, key: newIdempotencyKey(), notice: null }
    case 'step':
      return { ...state, step: action.step }
    case 'field':
      return { ...state, form: { ...state.form, [action.name]: action.value } }
    case 'slot_taken': // alguem pegou o horario: volta, mantem servico/data/dados
      return { ...state, step: 'datetime', slot: null, key: null, notice: action.notice }
    default:
      return state
  }
}

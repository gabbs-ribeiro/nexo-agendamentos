// Codigos devolvidos pelas funcoes do banco -> mensagens para o usuario.
// Nunca exibir texto bruto vindo do banco ou da rede.
export const ERROR_MESSAGES = {
  SLOT_UNAVAILABLE: 'Esse horário acabou de ser ocupado. Escolha outro horário.',
  SERVICE_UNAVAILABLE: 'Este serviço não está disponível no momento.',
  LIMIT_REACHED: 'Este telefone já tem o máximo de agendamentos futuros. Fale diretamente com o estabelecimento.',
  CONSENT_REQUIRED: 'Aceite o aviso de privacidade para continuar.',
  INVALID_INPUT: 'Confira os dados informados e tente novamente.',
  NOT_FOUND: 'Página não encontrada.',
  BOOKING_CONFLICT: 'Há um agendamento nesse período. Cancele-o antes de bloquear.',
  INVALID_TRANSITION: 'Essa mudança de status não é permitida.',
  INTERNAL_ERROR: 'Não foi possível concluir. Tente novamente em instantes.',
  NETWORK: 'Sem conexão com o serviço. Verifique sua internet e tente novamente.',
  UNKNOWN: 'Não foi possível concluir. Tente novamente em instantes.',
}

export class ApiError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ApiError'
    this.code = ERROR_MESSAGES[code] ? code : 'UNKNOWN'
  }
}

export function messageFor(err) {
  const code = err instanceof ApiError ? err.code : 'UNKNOWN'
  return ERROR_MESSAGES[code]
}

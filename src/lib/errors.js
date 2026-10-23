// Codigos devolvidos pelas funcoes do banco -> mensagens para o usuario.
// Nunca exibir texto bruto vindo do banco ou da rede.
export const ERROR_MESSAGES = {
  SLOT_UNAVAILABLE: 'Esse horário acabou de ser ocupado. Escolha outro horário.',
  STAY_FULL: 'A hospedagem acabou de esgotar nesse período. Escolha outras datas ou horários.',
  DAYCARE_FULL: 'Este período acabou de atingir a capacidade máxima. Escolha outro período ou dia.',
  INVALID_TIME_OPTIONS: 'A entrada passou ou a saída não corresponde a uma opção permitida. Ajuste o período e tente novamente.',
  SERVICE_UNAVAILABLE: 'Este serviço não está disponível no momento.',
  LIMIT_REACHED: 'Este telefone já tem o máximo de agendamentos futuros. Fale diretamente com o estabelecimento.',
  CONSENT_REQUIRED: 'Aceite o aviso de privacidade para continuar.',
  INVALID_INPUT: 'Confira os dados informados e tente novamente.',
  NOT_FOUND: 'Página não encontrada.',
  BOOKING_CONFLICT: 'Há um agendamento nesse período. Cancele-o antes de bloquear.',
  INVALID_TRANSITION: 'Essa mudança de status não é permitida.',
  INTERNAL_ERROR: 'Não foi possível concluir. Tente novamente em instantes.',
  NETWORK: 'Sem conexão com o serviço. Verifique sua internet e tente novamente.',
  AUTH_INVALID_CREDENTIALS: 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
  AUTH_UNCONFIRMED: 'Confirme seu e-mail antes de entrar.',
  AUTH_RATE_LIMIT: 'Muitas tentativas de acesso. Aguarde um pouco e tente novamente.',
  AUTH_GENERIC: 'Não foi possível entrar. Tente novamente em instantes.',
  AUTH_LOGOUT_FAILED: 'Não foi possível sair. Tente novamente.',
  AUTH_CHECK_FAILED: 'Não foi possível verificar seu acesso. Tente novamente.',
  AUTH_ACCESS_DENIED: 'Esta conta não está vinculada a um negócio autorizado.',
  INVALID_PROFILE_IMAGE: 'Escolha uma imagem PNG, JPG ou WEBP de até 1 MB.',
  LOGO_UPLOAD_FAILED: 'Não foi possível enviar a foto. Confira o arquivo e tente novamente.',
  DUPLICATE_NAME: 'Já existe um item com esse nome. Escolha outro nome.',
  CATEGORY_HAS_SERVICES: 'Mova ou exclua os serviços vinculados antes de excluir esta categoria.',
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

export function messageForAuthError(err) {
  switch (err?.code) {
    case 'invalid_credentials':
      return ERROR_MESSAGES.AUTH_INVALID_CREDENTIALS
    case 'email_not_confirmed':
      return ERROR_MESSAGES.AUTH_UNCONFIRMED
    case 'over_request_rate_limit':
    case 'too_many_requests':
      return ERROR_MESSAGES.AUTH_RATE_LIMIT
    default:
      return ERROR_MESSAGES.AUTH_GENERIC
  }
}

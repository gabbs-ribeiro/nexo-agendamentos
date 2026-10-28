// Calculo e textos do leva e traz (funcoes puras). O banco recalcula e valida tudo;
// aqui so mostramos a conta e montamos as mensagens de WhatsApp.
//
// frete = taxa de partida + distancia de IDA x 4 x valor por km
// (busca: ida e volta; entrega: ida e volta). Sempre os dois trechos.
import { formatBRL, whatsappUrl } from '../../lib/format.js'

export const TRANSPORT_TRIPS_FACTOR = 4
export const MAX_TRANSPORT_KM = 200

/** "6" | "6,5" | "6.5" -> 6.5 (uma casa decimal) ou null se invalido. */
export function parseKm(text) {
  const normalized = String(text ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const km = Math.round(Number(normalized) * 10) / 10
  return km > 0 && km <= MAX_TRANSPORT_KM ? km : null
}

/** "5" | "5,50" -> centavos (inteiro) ou null. Aceita 0 a 1000 reais. */
export function parseMoneyToCents(text) {
  const normalized = String(text ?? '').trim().replace(/^R\$\s*/, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const cents = Math.round(Number(normalized) * 100)
  return cents >= 0 && cents <= 100000 ? cents : null
}

/** centavos -> "5,50" (para preencher campos). */
export function centsToInput(cents) {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Conta do frete com inteiros (mesma regra do banco: arredonda o custo ao centavo).
 * distanceKm: so a ida. Devolve tudo o que a calculadora mostra.
 */
export function calcFreight({ distanceKm, startFeeCents, kmPriceCents }) {
  if (!(distanceKm > 0) || startFeeCents == null || kmPriceCents == null) return null
  const tenths = Math.round(distanceKm * 10)
  const kmCostCents = Math.floor((tenths * TRANSPORT_TRIPS_FACTOR * kmPriceCents + 5) / 10)
  return {
    distanceKm: tenths / 10,
    totalKm: (tenths * TRANSPORT_TRIPS_FACTOR) / 10,
    kmPriceCents,
    kmCostCents,
    startFeeCents,
    freightCents: startFeeCents + kmCostCents,
  }
}

/** "6" / "6,5" para exibir km sem zeros a mais. */
export function kmLabel(km) {
  return `${String(km).replace('.', ',')} km`
}

/** Valor da reserva com o leva e traz SO quando confirmado. */
export function totalWithTransport(baseCents, request) {
  return request?.status === 'confirmed' ? baseCents + (request.freight_cents ?? 0) : baseCents
}

export const TRANSPORT_STATUS_LABELS = {
  requested: 'Solicitado',
  quoted: 'Cotado',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
}

/** Endereco em linhas legiveis. Aceita o formato do banco (street_number) ou do formulario (number). */
export function addressLines(address) {
  const number = address.street_number ?? address.number
  const first = [address.street, number].filter(Boolean).join(', ')
  return [
    first,
    address.neighborhood,
    address.city,
    address.complement ? `Complemento: ${address.complement}` : '',
    address.reference ? `Ponto de referência: ${address.reference}` : '',
  ].filter(Boolean)
}

export function addressOneLine(address) {
  return addressLines(address).join(' - ')
}

/** Link do Google Maps para o endereco (so um link; nao usa API nem chave). */
export function mapsSearchUrl(address) {
  const query = [address.street, address.street_number ?? address.number, address.neighborhood, address.city]
    .filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

function withText(baseUrl, text) {
  return baseUrl ? `${baseUrl}?text=${encodeURIComponent(text)}` : null
}

/** Cliente -> estabelecimento. Sem valor: quem cota e a responsavel. */
export function customerWhatsappUrl({ businessPhone, serviceName, whenLabel, code, address }) {
  const lines = [
    'Olá! Acabei de agendar e quero solicitar o leva e traz.',
    '',
    `Serviço: ${serviceName}`,
    whenLabel ? `Quando: ${whenLabel}` : '',
    code ? `Código da reserva: ${code}` : '',
    '',
    'Meu endereço:',
    ...addressLines(address),
    '',
    'Pode me informar o valor?',
  ].filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
  return withText(whatsappUrl(businessPhone), lines.join('\n'))
}

/** Responsavel -> cliente, com o valor ja calculado. */
export function adminWhatsappUrl({ customerPhone, businessName, customerName, petName, serviceName, whenLabel, freightCents }) {
  const text = [
    `Olá, ${customerName}! Aqui é da ${businessName}.`,
    '',
    `Sobre o agendamento de ${petName} (${serviceName}${whenLabel ? `, ${whenLabel}` : ''}): o leva e traz fica em ${formatBRL(freightCents)}.`,
    '',
    'Você confirma que deseja contratar o leva e traz? Se sim, vamos combinar o horário para encontrar você e buscar o pet.',
  ].join('\n')
  return withText(whatsappUrl(customerPhone), text)
}

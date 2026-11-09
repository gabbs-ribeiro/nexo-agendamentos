/** "1 serviço", "3 serviços": texto de contagem exibido nas barras do Controle. */
export function countLabel(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

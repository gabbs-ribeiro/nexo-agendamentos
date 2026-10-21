export default function Notice({ tone = 'info', children }) {
  // Erros sao anunciados por leitores de tela; informativos nao interrompem.
  return (
    <div className="notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

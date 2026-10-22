/**
 * Barra expansivel do painel "Controle" (estilo lista de configuracoes).
 * Usa <details>/<summary> nativo: funciona com teclado e leitor de tela sem JavaScript extra,
 * e o conteudo continua montado quando fechado (o estado dos formularios e preservado).
 * Com o atributo `name`, abrir uma barra fecha as outras (navegadores que suportam).
 */
function Svg({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export const IconProfile = () => <Svg><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></Svg>
export const IconClock = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
export const IconSizes = () => <Svg><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>
export const IconTag = () => <Svg><path d="M3 12V4h8l10 10-8 8L3 12z" /><circle cx="7.5" cy="8.5" r="1" /></Svg>
export const IconList = () => <Svg><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Svg>
export const IconCamera = () => <Svg><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Svg>

export default function ControlBar({ icon, tone = 'peach', title, summary, children }) {
  return (
    <details className="control-bar" name="control-bars" data-tone={tone}>
      <summary>
        <span className="control-bar-icon" aria-hidden="true">{icon}</span>
        <span className="control-bar-text">
          <span className="control-bar-title">{title}</span>
          {summary && <span className="control-bar-summary">{summary}</span>}
        </span>
        <svg className="control-bar-chevron" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true" focusable="false">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </summary>
      <div className="control-bar-body stack">{children}</div>
    </details>
  )
}

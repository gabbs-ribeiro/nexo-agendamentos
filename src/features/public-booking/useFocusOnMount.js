import { useEffect, useRef } from 'react'

/** Leva o foco ao titulo do passo (leitores de tela) e rola para o topo ao trocar de passo. */
export function useFocusOnMount() {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [])
  return ref
}

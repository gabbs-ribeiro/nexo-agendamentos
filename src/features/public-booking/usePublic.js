import { useOutletContext } from 'react-router-dom'

/** { slug, business, services } carregados pelo PublicLayout. */
export function usePublic() {
  return useOutletContext()
}

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Trava de seguranca: o front NUNCA pode carregar uma chave privilegiada.
 * Recusa chaves "service_role" (JWT legado) e "sb_secret_..." (chave secreta nova).
 */
export function assertPublicKey(k) {
  if (!k) throw new Error('Configure VITE_SUPABASE_ANON_KEY (veja .env.example).')
  if (k.startsWith('sb_secret_')) {
    throw new Error('Chave secreta detectada no front. Use somente a chave anon/publishable.')
  }
  if (k.startsWith('eyJ')) {
    try {
      const b64 = k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const payload = JSON.parse(atob(b64))
      if (payload.role === 'service_role') {
        throw new Error('Chave service_role detectada no front. Use somente a chave anon/publishable.')
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('service_role')) throw e
      // JWT ilegivel: deixa o Supabase tratar
    }
  }
}

if (!url) throw new Error('Configure VITE_SUPABASE_URL (veja .env.example).')
assertPublicKey(key)

export const supabase = createClient(url, key)

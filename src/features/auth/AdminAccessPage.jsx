import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import Notice from '../../components/Notice.jsx'
import { ERROR_MESSAGES } from '../../lib/errors.js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase.js'
import { getAdminBusinesses } from './access.js'

export default function AdminAccessPage() {
  const navigate = useNavigate()
  const [state, setState] = useState({ status: 'loading' })
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  const checkAccess = useCallback(async () => {
    setState({ status: 'loading' })
    if (!isSupabaseConfigured) {
      setState({ status: 'configuration' })
      return
    }
    try {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw new Error()
      if (!data.user) {
        setState({ status: 'unauthenticated' })
        return
      }

      const businesses = await getAdminBusinesses(data.user.id)
      setState(businesses.length > 0 ? { status: 'authorized' } : { status: 'denied' })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => { checkAccess() }, [checkAccess])

  async function logout() {
    setLoggingOut(true)
    setLogoutError('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setLogoutError(ERROR_MESSAGES.AUTH_LOGOUT_FAILED)
        return
      }
      navigate('/login', { replace: true })
    } catch {
      setLogoutError(ERROR_MESSAGES.AUTH_LOGOUT_FAILED)
    } finally {
      setLoggingOut(false)
    }
  }

  if (state.status === 'unauthenticated') return <Navigate to="/login" replace />
  if (state.status === 'loading') {
    return <main className="page"><p className="status" role="status">Verificando sua sessão e seu vínculo…</p></main>
  }
  if (state.status === 'error') {
    return (
      <main className="page stack">
        <Notice tone="error">{ERROR_MESSAGES.AUTH_CHECK_FAILED}</Notice>
        <button type="button" className="btn btn-primary" onClick={checkAccess}>Tentar novamente</button>
      </main>
    )
  }
  if (state.status === 'configuration') {
    return (
      <main className="page stack">
        <Notice tone="error">
          A autenticação não está configurada. Defina a URL e a chave pública anon do projeto de desenvolvimento.
        </Notice>
      </main>
    )
  }

  return (
    <main className="page stack">
      <h1>Painel administrativo</h1>
      {state.status === 'denied' ? (
        <Notice tone="error">{ERROR_MESSAGES.AUTH_ACCESS_DENIED}</Notice>
      ) : (
        <Notice>
          Seu acesso foi validado. O painel administrativo ainda não foi implementado.
        </Notice>
      )}
      {logoutError && <Notice tone="error">{logoutError}</Notice>}
      <button type="button" className="btn btn-quiet" onClick={logout} disabled={loggingOut}>
        {loggingOut ? 'Saindo…' : 'Sair'}
      </button>
    </main>
  )
}

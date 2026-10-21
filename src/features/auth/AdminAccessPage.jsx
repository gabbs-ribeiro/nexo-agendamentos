import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import Notice from '../../components/Notice.jsx'
import { ERROR_MESSAGES } from '../../lib/errors.js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase.js'
import { getAdminBusinesses } from './access.js'
import AdminWorkspace from '../admin/AdminWorkspace.jsx'

export default function AdminAccessPage() {
  const [state, setState] = useState({ status: 'loading' })

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
      setState(businesses.length > 0
        ? { status: 'authorized', businesses }
        : { status: 'denied' })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => { checkAccess() }, [checkAccess])

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
  if (state.status === 'denied') {
    return (
      <main className="page stack">
        <Notice tone="error">{ERROR_MESSAGES.AUTH_ACCESS_DENIED}</Notice>
      </main>
    )
  }

  return <AdminWorkspace businesses={state.businesses} />
}

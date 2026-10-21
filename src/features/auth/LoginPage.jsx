import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Notice from '../../components/Notice.jsx'
import { ERROR_MESSAGES, messageForAuthError } from '../../lib/errors.js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase.js'
import { getAdminBusinesses } from './access.js'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    if (loading || !isSupabaseConfigured) return

    setLoading(true)
    setError('')
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        setError(messageForAuthError(signInError))
        return
      }
      if (!data.user) {
        setError(ERROR_MESSAGES.AUTH_GENERIC)
        return
      }

      const businesses = await getAdminBusinesses(data.user.id)
      if (businesses.length === 0) {
        await supabase.auth.signOut()
        setError(ERROR_MESSAGES.AUTH_ACCESS_DENIED)
        return
      }

      navigate('/admin', { replace: true })
    } catch {
      setError(ERROR_MESSAGES.AUTH_CHECK_FAILED)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page stack">
      <section className="auth-card stack">
        <div className="stack-sm">
          <h1>Acesso do estabelecimento</h1>
          <p className="muted">Entre com o e-mail e a senha fornecidos pelo responsável.</p>
        </div>

        {!isSupabaseConfigured && (
          <Notice tone="error">
            A autenticação não está configurada. Defina a URL e a chave pública anon do projeto de desenvolvimento.
          </Notice>
        )}

        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="login-email">E-mail</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Senha</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error && <Notice tone="error">{error}</Notice>}

          <button type="submit" className="btn btn-primary" disabled={loading || !isSupabaseConfigured}>
            {loading ? 'Verificando acesso…' : 'Entrar'}
          </button>
        </form>
        <p className="small muted">O cadastro de responsáveis é feito manualmente pelo painel do Supabase.</p>
      </section>
    </main>
  )
}

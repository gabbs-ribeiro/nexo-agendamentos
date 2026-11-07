import { useEffect, useState } from 'react'
import Notice from '../../components/Notice.jsx'
import { supabase } from '../../lib/supabase.js'
import { decodeVapidPublicKey } from '../../lib/pushNotifications.js'

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY

function browserSupportsPush() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export default function PushNotificationsSection({ businessId }) {
  const [status, setStatus] = useState('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [subscription, setSubscription] = useState(null)

  useEffect(() => {
    let active = true

    async function load() {
      if (!browserSupportsPush() || !supabase) {
        setStatus('unsupported')
        return
      }
      try {
        const [{ data: userData, error: userError }, registration] = await Promise.all([
          supabase.auth.getUser(),
          navigator.serviceWorker.register('/sw.js'),
        ])
        if (userError || !userData.user) throw new Error('auth')
        const currentSubscription = await registration.pushManager.getSubscription()
        if (!active) return
        setSubscription(currentSubscription)
        if (!currentSubscription) {
          setStatus('ready')
          return
        }

        const { data, error: queryError } = await supabase
          .from('push_subscriptions')
          .select('id')
          .eq('business_id', businessId)
          .eq('user_id', userData.user.id)
          .eq('endpoint', currentSubscription.endpoint)
          .maybeSingle()
        if (queryError) throw new Error('storage')
        if (active) setStatus(data ? 'enabled' : 'ready')
      } catch {
        if (active) {
          setError('Não foi possível verificar as notificações. Tente novamente mais tarde.')
          setStatus('error')
        }
      }
    }

    setStatus('loading')
    setError('')
    load()
    return () => { active = false }
  }, [businessId])

  async function enable() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (!vapidPublicKey) throw new Error('config')
      if (!browserSupportsPush()) throw new Error('unsupported')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('permission')

      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) throw new Error('auth')

      const registration = await navigator.serviceWorker.register('/sw.js')
      const currentSubscription = subscription
        ?? await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(vapidPublicKey),
        })
      const keys = currentSubscription.toJSON().keys
      if (!keys?.p256dh || !keys?.auth) throw new Error('subscription')

      const { error: saveError } = await supabase.from('push_subscriptions').upsert({
        business_id: businessId,
        user_id: userData.user.id,
        endpoint: currentSubscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      }, { onConflict: 'business_id,user_id,endpoint' })
      if (saveError) throw new Error('storage')

      setSubscription(currentSubscription)
      setStatus('enabled')
    } catch (cause) {
      const messages = {
        config: 'As notificações ainda não foram configuradas neste ambiente.',
        unsupported: 'Este navegador não oferece suporte a notificações push.',
        auth: 'Sua sessão expirou. Entre novamente para ativar as notificações.',
        permission: 'A permissão para notificações não foi concedida. Confira as permissões do navegador.',
        subscription: 'Não foi possível registrar este navegador para notificações.',
        storage: 'Não foi possível salvar a inscrição. Confira a configuração do banco e tente novamente.',
      }
      setError(messages[cause.message] || 'Não foi possível ativar as notificações. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) throw new Error('auth')
      const currentSubscription = subscription
        ?? await (await navigator.serviceWorker.ready).pushManager.getSubscription()
      if (currentSubscription) {
        const { error: deleteError } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('business_id', businessId)
          .eq('user_id', userData.user.id)
          .eq('endpoint', currentSubscription.endpoint)
        if (deleteError) throw new Error('storage')
        await currentSubscription.unsubscribe()
      }
      setSubscription(null)
      setStatus('ready')
    } catch (cause) {
      const messages = {
        auth: 'Sua sessão expirou. Entre novamente para desativar as notificações.',
        storage: 'Não foi possível remover a inscrição. Tente novamente.',
      }
      setError(messages[cause.message] || 'Não foi possível desativar as notificações. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  const unsupported = status === 'unsupported'
  const permissionDenied = browserSupportsPush() && Notification.permission === 'denied'

  return (
    <section className="stack" aria-labelledby="push-notifications-title">
      <div>
        <h3 id="push-notifications-title">Notificações do navegador</h3>
        <p className="muted">Receba um aviso neste navegador quando um novo agendamento for criado, mesmo com o painel fechado.</p>
      </div>
      {unsupported && <Notice>Este navegador não oferece suporte a notificações push. Tente usar outro navegador atualizado.</Notice>}
      {permissionDenied && <Notice>As notificações estão bloqueadas nas permissões do navegador. Altere essa permissão e tente novamente.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {status === 'enabled'
        ? (
          <div className="stack">
            <p className="status" role="status">Notificações ativadas neste navegador.</p>
            <button type="button" className="btn btn-quiet" onClick={disable} disabled={busy}>
              {busy ? 'Desativando…' : 'Desativar neste navegador'}
            </button>
          </div>
        )
        : (
            <button type="button" className="btn btn-primary" onClick={enable}
              disabled={busy || status === 'loading' || unsupported || permissionDenied}>
              {busy ? 'Ativando…' : status === 'loading' ? 'Verificando…' : 'Ativar notificações neste navegador'}
            </button>
          )}
    </section>
  )
}

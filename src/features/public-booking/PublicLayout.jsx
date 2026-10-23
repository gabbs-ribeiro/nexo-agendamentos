import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import {
  getPublicBusiness, listPublicBookingModels, listPublicServiceCategories, listPublicServices, logoUrl,
} from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { brandOrDefault, readableOn } from '../../lib/format.js'
import Notice from '../../components/Notice.jsx'

function Logo({ business }) {
  const [failed, setFailed] = useState(false)
  const src = logoUrl(business.logo_path)
  if (!src || failed) {
    return <span className="logo-fallback" aria-hidden="true">{business.name.trim().charAt(0).toUpperCase()}</span>
  }
  return <img className="logo" src={src} alt="" width="40" height="40" onError={() => setFailed(true)} />
}

export default function PublicLayout() {
  const slug = useParams().slug.toLowerCase()
  const [state, setState] = useState({ status: 'loading' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const [business, services, categories, models] = await Promise.all([
        getPublicBusiness(slug),
        listPublicServices(slug),
        listPublicServiceCategories(slug),
        listPublicBookingModels(slug),
      ])
      const modelByService = new Map(models.map((model) => [model.service_id, model]))
      const applyModel = (service) => {
        const model = modelByService.get(service.service_id)
        if (!model) return service
        const prices = new Map((model.options ?? []).map((item) => [item.option_id, item]))
        return {
          ...service,
          booking_mode: model.booking_mode,
          booking_settings: model.settings,
          options: service.options.map((option) => ({ ...option, ...prices.get(option.option_id) })),
        }
      }
      const publicServices = services.map(applyModel)
      const publicCategories = categories.map((category) => ({
        ...category,
        services: category.services.map(applyModel),
      }))
      setState(business
        ? { status: 'ready', business, services: publicServices, categories: publicCategories }
        : { status: 'notfound' })
    } catch (err) {
      setState({ status: 'error', message: messageFor(err) })
    }
  }, [slug])

  useEffect(() => { load() }, [load])

  const name = state.status === 'ready' ? state.business.name : null
  useEffect(() => {
    if (!name) return undefined
    document.title = `${name} · Agendamento`
    return () => { document.title = 'Agendamentos' }
  }, [name])

  if (state.status === 'loading') {
    return <main className="page"><p className="status" role="status">Carregando…</p></main>
  }
  if (state.status === 'notfound') {
    return (
      <main className="page stack">
        <h1>Página não encontrada</h1>
        <p className="muted">Confira o link com o estabelecimento.</p>
      </main>
    )
  }
  if (state.status === 'error') {
    return (
      <main className="page stack">
        <Notice tone="error">{state.message}</Notice>
        <button type="button" className="btn btn-primary" onClick={load}>Tentar novamente</button>
      </main>
    )
  }

  const { business, services, categories } = state
  const brand = brandOrDefault(business.primary_color)
  return (
    <div className="shell" style={{ '--brand': brand, '--on-brand': readableOn(brand) }}>
      <header className="site-header">
        <Link className="site-header-inner" to={`/${slug}`}>
          <Logo business={business} />
          <span className="site-name">{business.name}</span>
        </Link>
      </header>
      <main className="page">
        <Outlet context={{ slug, business, services, categories }} />
      </main>
      <footer className="site-footer small muted">
        <Link to={`/${slug}/privacidade`}>Aviso de privacidade</Link>
        <span className="site-footer-brand">Nexo Agendamentos</span>
      </footer>
    </div>
  )
}

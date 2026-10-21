import { useCallback, useEffect, useMemo, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import Notice from '../../components/Notice.jsx'
import {
  archiveService,
  getBusinessControl,
  listBusinessCatalog,
  logoUrl,
  removeBusinessLogo,
  saveBusinessSize,
  saveService,
  setBusinessSizeActive,
  updateBusinessProfile,
  uploadBusinessLogo,
} from '../../lib/api.js'
import { ERROR_MESSAGES, messageFor } from '../../lib/errors.js'
import { formatBRL } from '../../lib/format.js'
import { useAdminBusiness } from './AdminBusinessContext.jsx'
import { priceToCents, sizeCodeForName } from './serviceCatalog.js'

function ErrorNotice({ children }) {
  return children ? <Notice tone="error">{children}</Notice> : null
}

function LogoPreview({ path, name }) {
  const [failed, setFailed] = useState(false)
  const url = logoUrl(path)
  useEffect(() => { setFailed(false) }, [url])
  if (!url || failed) {
    return <span className="control-avatar-fallback" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
  }
  return <img className="control-avatar" src={url} alt="" onError={() => setFailed(true)} />
}

function newDraft(sizes) {
  return {
    id: null,
    name: '',
    description: '',
    options: Object.fromEntries(sizes.map((size) => [size.code, {
      id: null,
      price: '',
      duration: '30',
      enabled: false,
    }])),
  }
}

export default function ControlPage() {
  const business = useAdminBusiness()
  const [state, setState] = useState({ status: 'loading' })
  const [profile, setProfile] = useState(null)
  const [profileDraft, setProfileDraft] = useState({ name: '', primary_color: '#ef946f' })
  const [logoFile, setLogoFile] = useState(null)
  const [profileError, setProfileError] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [sizeDrafts, setSizeDrafts] = useState({})
  const [newSize, setNewSize] = useState('')
  const [sizeError, setSizeError] = useState('')
  const [savingSize, setSavingSize] = useState(false)
  const [draft, setDraft] = useState(null)
  const [serviceError, setServiceError] = useState('')
  const [serviceNotice, setServiceNotice] = useState('')
  const [savingService, setSavingService] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const [businessProfile, catalog] = await Promise.all([
        getBusinessControl(business.id),
        listBusinessCatalog(business.id),
      ])
      setProfile(businessProfile)
      setProfileDraft({ name: businessProfile.name, primary_color: businessProfile.primary_color })
      setSizeDrafts(Object.fromEntries(catalog.sizes.map((size) => [size.code, size.name])))
      setState({ status: 'ready', ...catalog })
    } catch (error) {
      setState({ status: 'error', message: messageFor(error) })
    }
  }, [business.id])

  useEffect(() => { load() }, [load])

  const activeSizes = useMemo(
    () => state.status === 'ready' ? state.sizes.filter((size) => size.is_active) : [],
    [state],
  )
  const previewUrl = useMemo(() => logoFile ? URL.createObjectURL(logoFile) : null, [logoFile])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  function editService(service) {
    const options = Object.fromEntries(activeSizes.map((size) => {
      const option = service.options.find((item) => item.size === size.code)
      return [size.code, {
        id: option?.id ?? null,
        price: option ? (option.price_cents / 100).toFixed(2).replace('.', ',') : '',
        duration: option ? String(option.duration_minutes) : '30',
        enabled: Boolean(option?.is_active),
      }]
    }))
    setDraft({
      id: service.id,
      name: service.name,
      description: service.description ?? '',
      options,
    })
    setServiceError('')
    setServiceNotice('')
  }

  function updateOption(code, key, value) {
    setDraft((current) => ({
      ...current,
      options: {
        ...current.options,
        [code]: {
          ...(current.options[code] ?? { id: null, price: '', duration: '30', enabled: false }),
          [key]: value,
        },
      },
    }))
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (savingProfile || !profile) return
    setSavingProfile(true)
    setProfileError('')
    setProfileNotice('')
    let uploadedPath = null
    let newPath = profile.logo_path
    try {
      const name = profileDraft.name.trim()
      if (!name || name.length > 80) {
        setProfileError('Informe um nome de estabelecimento com até 80 caracteres.')
        return
      }
      if (logoFile) {
        uploadedPath = await uploadBusinessLogo(business.id, logoFile)
        newPath = uploadedPath
      }
      try {
        await updateBusinessProfile(business.id, {
          name,
          primary_color: profileDraft.primary_color,
          logo_path: newPath,
        })
      } catch (error) {
        if (uploadedPath) {
          try { await removeBusinessLogo(uploadedPath) } catch (cleanupError) {
            console.error('[business logo cleanup]', cleanupError.code)
          }
        }
        throw error
      }
      setProfile({ ...profile, ...profileDraft, name, logo_path: newPath })
      setLogoFile(null)
      if (uploadedPath && profile.logo_path) {
        try {
          await removeBusinessLogo(profile.logo_path)
          setProfileNotice('Perfil atualizado. A página de agendamento já mostra as novas informações.')
        } catch {
          setProfileNotice('Perfil atualizado. A foto antiga não pôde ser removida; a nova já está ativa.')
        }
      } else {
        setProfileNotice('Perfil atualizado. A página de agendamento já mostra as novas informações.')
      }
    } catch (error) {
      setProfileError(messageFor(error))
    } finally {
      setSavingProfile(false)
    }
  }

  async function addSize(event) {
    event.preventDefault()
    const name = newSize.trim()
    if (savingSize) return
    if (!name || name.length > 40) {
      setSizeError('Informe um nome de porte com até 40 caracteres.')
      return
    }
    setSavingSize(true)
    setSizeError('')
    try {
      await saveBusinessSize(business.id, {
        name,
        newCode: sizeCodeForName(name),
        sort_order: state.sizes.length,
      })
      setNewSize('')
      await load()
    } catch (error) {
      setSizeError(messageFor(error))
    } finally {
      setSavingSize(false)
    }
  }

  async function saveSizeName(size) {
    const name = (sizeDrafts[size.code] ?? '').trim()
    if (savingSize) return
    if (!name || name.length > 40) {
      setSizeError('Informe um nome de porte com até 40 caracteres.')
      return
    }
    setSavingSize(true)
    setSizeError('')
    try {
      await saveBusinessSize(business.id, { code: size.code, name })
      await load()
    } catch (error) {
      setSizeError(messageFor(error))
    } finally {
      setSavingSize(false)
    }
  }

  async function toggleSize(size) {
    setConfirmBusy(true)
    setConfirmError('')
    try {
      await setBusinessSizeActive(business.id, size.code, !size.is_active)
      setConfirmAction(null)
      await load()
    } catch (error) {
      setConfirmError(messageFor(error))
    } finally {
      setConfirmBusy(false)
    }
  }

  async function submitService(event) {
    event.preventDefault()
    if (savingService || !draft) return
    setSavingService(true)
    setServiceError('')
    setServiceNotice('')
    try {
      if (!draft.name.trim() || draft.name.trim().length > 80 || draft.description.length > 300) {
        throw new Error('validation')
      }
      const options = activeSizes.map((size) => {
        const option = draft.options[size.code] ?? { id: null, price: '', duration: '30', enabled: false }
        if (!option.enabled) return option.id
          ? { id: option.id, size: size.code, is_active: false }
          : { id: null, size: size.code, is_active: false }
        const priceCents = priceToCents(option.price)
        const duration = Number(option.duration)
        if (priceCents === null || !Number.isInteger(duration) || duration < 5 || duration > 720) {
          throw new Error('validation')
        }
        return {
          id: option.id,
          size: size.code,
          price_cents: priceCents,
          duration_minutes: duration,
          is_active: true,
        }
      })
      if (!options.some((option) => option.is_active)) throw new Error('validation')
      await saveService(business.id, { ...draft, name: draft.name.trim() }, options)
      setDraft(null)
      setServiceNotice('Serviço salvo. As alterações valem para novos agendamentos.')
      await load()
    } catch (error) {
      setServiceError(error.message === 'validation'
        ? 'Confira o nome, a descrição, os preços e os tempos. Selecione ao menos um porte.'
        : messageFor(error))
      await load()
    } finally {
      setSavingService(false)
    }
  }

  async function confirmServiceArchive() {
    if (!confirmAction || confirmBusy) return
    setConfirmBusy(true)
    setConfirmError('')
    try {
      await archiveService(business.id, confirmAction.id)
      setConfirmAction(null)
      setDraft(null)
      setServiceNotice('Serviço arquivado. Agendamentos anteriores foram preservados.')
      await load()
    } catch (error) {
      setConfirmError(messageFor(error))
    } finally {
      setConfirmBusy(false)
    }
  }

  if (state.status === 'loading') return <p className="status" role="status">Carregando controle do estabelecimento…</p>
  if (state.status === 'error') return <section className="stack"><Notice tone="error">{state.message || ERROR_MESSAGES.NETWORK}</Notice><button className="btn btn-quiet" onClick={load}>Tentar novamente</button></section>

  return (
    <div className="control-page stack">
      <header className="admin-hero">
        <div className="admin-hero-copy">
          <span className="eyebrow">Seu espaço, seu jeito</span>
          <h1>Controle</h1>
          <p>Cuide do perfil que seus clientes veem e deixe os serviços prontos para reserva.</p>
        </div>
        <span className="hero-paw" aria-hidden="true">✿</span>
      </header>

      <section className="control-card stack" aria-labelledby="profile-title">
        <div className="control-section-heading">
          <div><span className="eyebrow">Aparece para os tutores</span><h2 id="profile-title">Perfil público</h2></div>
          <LogoPreview path={previewUrl ?? profile?.logo_path} name={profileDraft.name || business.name} />
        </div>
        <p className="muted">Nome e foto também aparecem na página de agendamento.</p>
        <form className="control-form" onSubmit={saveProfile}>
          <div className="field">
            <label htmlFor="business-name">Nome do estabelecimento</label>
            <input id="business-name" type="text" maxLength={80} required value={profileDraft.name}
              onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="business-logo">Foto do perfil</label>
            <input id="business-logo" type="file" accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} />
            <span className="hint">PNG, JPG ou WEBP, até 1 MB. A imagem é pública na página de agendamento.</span>
          </div>
          <div className="field control-color-field">
            <label htmlFor="business-color">Cor de destaque</label>
            <input id="business-color" type="color" value={profileDraft.primary_color}
              onChange={(event) => setProfileDraft((current) => ({ ...current, primary_color: event.target.value }))} />
          </div>
          <ErrorNotice>{profileError}</ErrorNotice>
          {profileNotice && <Notice>{profileNotice}</Notice>}
          <button className="btn btn-primary" type="submit" disabled={savingProfile}>
            {savingProfile ? 'Salvando perfil…' : 'Salvar perfil'}
          </button>
        </form>
      </section>

      <section className="control-card stack" aria-labelledby="sizes-title">
        <div className="control-section-heading">
          <div><span className="eyebrow">Padrões de atendimento</span><h2 id="sizes-title">Portes disponíveis</h2></div>
          <span className="control-icon" aria-hidden="true">＋</span>
        </div>
        <p className="muted">Os portes são compartilhados entre os serviços. Ao renomear um porte, o histórico já salvo permanece igual.</p>
        <div className="size-list">
          {state.sizes.map((size) => (
            <div className="size-row" key={size.code}>
              <label className="field">
                <span className="sr-only">Nome do porte {size.name}</span>
                <input type="text" maxLength={40} value={sizeDrafts[size.code] ?? size.name}
                  onChange={(event) => setSizeDrafts((current) => ({ ...current, [size.code]: event.target.value }))} />
              </label>
              <button className="btn btn-quiet size-save" type="button" disabled={savingSize || !size.is_active}
                onClick={() => saveSizeName(size)}>Salvar</button>
              <button className="btn-text size-status" type="button"
                onClick={() => { setConfirmError(''); setConfirmAction({ kind: 'size', ...size }) }}>
                {size.is_active ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          ))}
        </div>
        <form className="add-size-form" onSubmit={addSize}>
          <div className="field">
            <label htmlFor="new-size">Adicionar porte</label>
            <input id="new-size" type="text" maxLength={40} value={newSize}
              onChange={(event) => setNewSize(event.target.value)} placeholder="Ex.: Gigante" required />
          </div>
          <button className="btn btn-quiet" type="submit" disabled={savingSize}>{savingSize ? 'Adicionando…' : 'Adicionar porte'}</button>
        </form>
        <ErrorNotice>{sizeError}</ErrorNotice>
      </section>

      <section className="control-card stack" aria-labelledby="services-title">
        <div className="control-section-heading">
          <div><span className="eyebrow">O que você oferece</span><h2 id="services-title">Serviços para reserva</h2></div>
          <button className="btn btn-primary add-service-button" type="button" onClick={() => {
            setDraft(newDraft(activeSizes)); setServiceError(''); setServiceNotice('')
          }}>Adicionar serviço</button>
        </div>
        {serviceNotice && <Notice>{serviceNotice}</Notice>}
        <ErrorNotice>{serviceError}</ErrorNotice>
        {state.services.length === 0 && <p className="muted">Nenhum serviço cadastrado ainda.</p>}
        <div className="service-cards">
          {state.services.map((service) => (
            <article className="service-card" key={service.id} data-archived={Boolean(service.archived_at)}>
              <div className="service-card-top">
                <div><h3>{service.name}</h3><p className="muted">{service.description || 'Sem descrição'}</p></div>
                {service.archived_at && <span className="booking-status">Arquivado</span>}
              </div>
              <ul className="service-option-summary">
                {service.options.filter((option) => option.is_active).map((option) => {
                  const size = state.sizes.find((item) => item.code === option.size)
                  return <li key={option.id}><span>{size?.name ?? option.size}</span><span>{option.duration_minutes} min</span><strong>{formatBRL(option.price_cents)}</strong></li>
                })}
              </ul>
              {!service.archived_at && <div className="service-card-actions">
                <button className="btn btn-quiet" type="button" onClick={() => editService(service)}>Editar</button>
                <button className="btn-text" type="button" onClick={() => {
                  setConfirmError(''); setConfirmAction({ kind: 'service', id: service.id, name: service.name })
                }}>Arquivar</button>
              </div>}
            </article>
          ))}
        </div>
        {draft && (
          <form className="service-editor stack" onSubmit={submitService}>
            <div className="control-section-heading">
              <h3>{draft.id ? 'Editar serviço' : 'Novo serviço'}</h3>
              <button className="btn-text" type="button" onClick={() => setDraft(null)}>Fechar</button>
            </div>
            <div className="field"><label htmlFor="service-name">Nome do serviço</label>
              <input id="service-name" type="text" maxLength={80} required value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="field"><label htmlFor="service-description">Descrição</label>
              <textarea id="service-description" maxLength={300} value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></div>
            <fieldset className="service-size-options">
              <legend>Portes atendidos, preço e duração</legend>
              {activeSizes.map((size) => {
                const option = draft.options[size.code] ?? { id: null, price: '', duration: '30', enabled: false }
                return <div className="service-size-editor" key={size.code}>
                  <label className="consent"><input type="checkbox" checked={option.enabled}
                    onChange={(event) => updateOption(size.code, 'enabled', event.target.checked)} /><span>{size.name}</span></label>
                  {option.enabled && <div className="size-price-duration">
                    <div className="field"><label htmlFor={`price-${size.code}`}>Preço (R$)</label>
                      <input id={`price-${size.code}`} type="text" inputMode="decimal" placeholder="45,00" required
                        value={option.price} onChange={(event) => updateOption(size.code, 'price', event.target.value)} /></div>
                    <div className="field"><label htmlFor={`duration-${size.code}`}>Tempo (min)</label>
                      <input id={`duration-${size.code}`} type="number" min="5" max="720" step="1" required
                        value={option.duration} onChange={(event) => updateOption(size.code, 'duration', event.target.value)} /></div>
                  </div>}
                </div>
              })}
            </fieldset>
            <p className="hint">O tempo configurado é usado pelo banco para reservar o intervalo correto na agenda.</p>
            <ErrorNotice>{serviceError}</ErrorNotice>
            <button className="btn btn-primary" type="submit" disabled={savingService}>
              {savingService ? 'Salvando serviço…' : 'Salvar serviço'}
            </button>
          </form>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.kind === 'service'
          ? `Arquivar o serviço “${confirmAction?.name}”?`
          : `${confirmAction?.is_active ? 'Desativar' : 'Reativar'} o porte “${confirmAction?.name}”?`}
        description={confirmAction?.kind === 'service'
          ? 'Ele deixará de aparecer para novas reservas. Agendamentos antigos continuarão preservados.'
          : 'Essa alteração afeta quais portes podem ser reservados em todos os serviços.'}
        confirmLabel={confirmAction?.kind === 'service' ? 'Sim, arquivar serviço' : confirmAction?.is_active ? 'Sim, desativar porte' : 'Sim, reativar porte'}
        busy={confirmBusy}
        error={confirmError}
        onCancel={() => { setConfirmAction(null); setConfirmError('') }}
        onConfirm={confirmAction?.kind === 'service' ? confirmServiceArchive : () => toggleSize(confirmAction)}
      />
    </div>
  )
}

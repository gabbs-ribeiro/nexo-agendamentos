import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import ControlBar, { IconClock, IconList, IconProfile, IconSizes, IconTag } from '../../components/ControlBar.jsx'
import Notice from '../../components/Notice.jsx'
import {
  archiveService,
  deleteServiceCategory,
  getBusinessControl,
  listBusinessCatalog,
  removeBusinessLogo,
  saveBusinessSize,
  saveServiceCategory,
  saveService,
  reactivateService,
  setBusinessSizeActive,
  updateBusinessProfile,
  uploadBusinessLogo,
} from '../../lib/api.js'
import { ERROR_MESSAGES, messageFor } from '../../lib/errors.js'
import { digitsOnly, formatBRL, isValidPhone, maskPhone } from '../../lib/format.js'
import { parseTimeRange } from '../../lib/timeRanges.js'
import { useAdminBusiness, useUpdateAdminBusiness } from './AdminBusinessContext.jsx'
import BusinessHoursSection from './BusinessHoursSection.jsx'
import { countLabel } from './controlSummary.js'
import ProfileHeader from './ProfileHeader.jsx'
import { groupServicesByCategory } from './catalogCategories.js'
import {
  BOOKING_MODE_LABELS,
  isDailyService,
  isValidPeriodSettings,
  normalizeBookingMode,
  priceToCents,
  resolveDurationMinutes,
  sizeCodeForName,
} from './serviceCatalog.js'

function ErrorNotice({ children }) {
  return children ? <Notice tone="error">{children}</Notice> : null
}

function newDraft(sizes, categories) {
  return {
    id: null,
    category_id: categories[0]?.id ?? '',
    name: '',
    description: '',
    booking_mode: 'hourly',
    settings: {
      morning_start: '',
      morning_end: '',
      afternoon_start: '',
      afternoon_end: '',
      check_in_start: '',
      check_in_end: '',
      check_out_start: '',
      check_out_end: '',
    },
    options: Object.fromEntries(sizes.map((size) => [size.code, {
      id: null,
      price: '',
      morning_price: '',
      afternoon_price: '',
      full_day_price: '',
      duration: '30',
      enabled: false,
    }])),
  }
}

export default function ControlPage() {
  const business = useAdminBusiness()
  const updateAdminBusiness = useUpdateAdminBusiness()
  const [state, setState] = useState({ status: 'loading' })
  const [profile, setProfile] = useState(null)
  const [profileDraft, setProfileDraft] = useState({ name: '', primary_color: '#ef946f' })
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoNotice, setPhotoNotice] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [sizeDrafts, setSizeDrafts] = useState({})
  const [newSize, setNewSize] = useState('')
  const [sizeError, setSizeError] = useState('')
  const [savingSize, setSavingSize] = useState(false)
  const [draft, setDraft] = useState(null)
  const [categoryDraft, setCategoryDraft] = useState(null)
  const [categoryError, setCategoryError] = useState('')
  const [categoryNotice, setCategoryNotice] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)
  const [serviceError, setServiceError] = useState('')
  const [serviceNotice, setServiceNotice] = useState('')
  const [savingService, setSavingService] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const serviceDialogRef = useRef(null)
  const categoryDialogRef = useRef(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const [businessProfile, catalog] = await Promise.all([
        getBusinessControl(business.id),
        listBusinessCatalog(business.id),
      ])
      setProfile(businessProfile)
      setProfileDraft({
        name: businessProfile.name,
        primary_color: businessProfile.primary_color,
        contact_phone: maskPhone(businessProfile.contact_phone ?? ''),
      })
      setSizeDrafts(Object.fromEntries(catalog.sizes.map((size) => [size.code, size.name])))
      setState({ status: 'ready', ...catalog })
    } catch (error) {
      setState({ status: 'error', message: messageFor(error) })
    }
  }, [business.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const dialog = serviceDialogRef.current
    if (!dialog) return
    if (draft && !dialog.open) dialog.showModal()
    if (!draft && dialog.open) dialog.close()
  }, [draft])

  useEffect(() => {
    const dialog = categoryDialogRef.current
    if (!dialog) return
    if (categoryDraft && !dialog.open) dialog.showModal()
    if (!categoryDraft && dialog.open) dialog.close()
  }, [categoryDraft])

  const activeSizes = useMemo(
    () => state.status === 'ready' ? state.sizes.filter((size) => size.is_active) : [],
    [state],
  )

  function editService(service) {
    const options = Object.fromEntries(activeSizes.map((size) => {
      const option = service.options.find((item) => item.size === size.code)
      return [size.code, {
        id: option?.id ?? null,
        price: option ? (option.price_cents / 100).toFixed(2).replace('.', ',') : '',
        morning_price: option?.morning_price_cents == null ? '' : (option.morning_price_cents / 100).toFixed(2).replace('.', ','),
        afternoon_price: option?.afternoon_price_cents == null ? '' : (option.afternoon_price_cents / 100).toFixed(2).replace('.', ','),
        full_day_price: option?.full_day_price_cents == null ? '' : (option.full_day_price_cents / 100).toFixed(2).replace('.', ','),
        duration: option ? String(option.duration_minutes) : '30',
        enabled: Boolean(option?.is_active),
      }]
    }))
    setDraft({
      id: service.id,
      category_id: service.category_id,
      name: service.name,
      description: service.description ?? '',
      booking_mode: normalizeBookingMode(service.booking_mode),
      settings: {
        morning_start: service.settings?.morning_start?.slice(0, 5) ?? '',
        morning_end: service.settings?.morning_end?.slice(0, 5) ?? '',
        afternoon_start: service.settings?.afternoon_start?.slice(0, 5) ?? '',
        afternoon_end: service.settings?.afternoon_end?.slice(0, 5) ?? '',
        check_in_start: service.settings?.check_in_start?.slice(0, 5) ?? '',
        check_in_end: service.settings?.check_in_end?.slice(0, 5) ?? '',
        check_out_start: service.settings?.check_out_start?.slice(0, 5) ?? '',
        check_out_end: service.settings?.check_out_end?.slice(0, 5) ?? '',
      },
      options,
    })
    setServiceError('')
    setServiceNotice('')
    setCategoryError('')
  }

  function updateOption(code, key, value) {
    setDraft((current) => ({
      ...current,
      options: {
        ...current.options,
        [code]: {
          ...(current.options[code] ?? {
            id: null, price: '', morning_price: '', afternoon_price: '', full_day_price: '',
            duration: '30', enabled: false,
          }),
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
    try {
      const name = profileDraft.name.trim()
      if (!name || name.length > 80) {
        setProfileError('Informe um nome de estabelecimento com até 80 caracteres.')
        return
      }
      const contactPhone = digitsOnly(profileDraft.contact_phone)
      if (contactPhone && !isValidPhone(profileDraft.contact_phone)) {
        setProfileError('Informe um WhatsApp válido com DDD ou deixe o campo vazio.')
        return
      }
      await updateBusinessProfile(business.id, {
        name,
        primary_color: profileDraft.primary_color,
        logo_path: profile.logo_path,
        contact_phone: contactPhone || null,
      })
      setProfile({
        ...profile,
        name,
        primary_color: profileDraft.primary_color,
        contact_phone: contactPhone || null,
      })
      updateAdminBusiness({
        id: business.id,
        name,
        primary_color: profileDraft.primary_color,
        contact_phone: contactPhone || null,
      })
      setProfileNotice('Perfil atualizado. A página de agendamento já mostra as novas informações.')
    } catch (error) {
      setProfileError(messageFor(error))
    } finally {
      setSavingProfile(false)
    }
  }

  // Troca a foto ao escolher o arquivo no topo da pagina. Usa os dados JA SALVOS do perfil
  // (nao leva rascunhos nao salvos do formulario). A validacao de tipo/tamanho e do uploadBusinessLogo.
  async function changePhoto(file) {
    if (photoBusy || !profile) return
    setPhotoBusy(true)
    setPhotoError('')
    setPhotoNotice('')
    let uploadedPath = null
    try {
      uploadedPath = await uploadBusinessLogo(business.id, file)
      try {
        await updateBusinessProfile(business.id, {
          name: profile.name,
          primary_color: profile.primary_color,
          logo_path: uploadedPath,
          contact_phone: profile.contact_phone ?? null,
        })
      } catch (error) {
        try { await removeBusinessLogo(uploadedPath) } catch (cleanupError) {
          console.error('[business logo cleanup]', cleanupError.code)
        }
        throw error
      }
      const previousPath = profile.logo_path
      setProfile((current) => ({ ...current, logo_path: uploadedPath }))
      updateAdminBusiness({ id: business.id, logo_path: uploadedPath })
      let message = 'Foto atualizada. A página de agendamento já mostra a nova imagem.'
      if (previousPath) {
        try { await removeBusinessLogo(previousPath) } catch {
          message = 'Foto atualizada. A foto antiga não pôde ser removida; a nova já está ativa.'
        }
      }
      setPhotoNotice(message)
    } catch (error) {
      setPhotoError(messageFor(error))
    } finally {
      setPhotoBusy(false)
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
      if (!state.categories.some((category) => category.id === draft.category_id)
        || !draft.name.trim() || draft.name.trim().length > 80 || draft.description.length > 300) {
        throw new Error('validation')
      }
      const options = activeSizes.map((size) => {
        const option = draft.options[size.code] ?? {
          id: null, price: '', morning_price: '', afternoon_price: '', full_day_price: '',
          duration: '30', enabled: false,
        }
        if (!option.enabled) return option.id
          ? { id: option.id, size: size.code, is_active: false }
          : { id: null, size: size.code, is_active: false }
        const priceCents = priceToCents(
          draft.booking_mode === 'periods' ? option.morning_price : option.price,
        )
        const duration = resolveDurationMinutes(draft.booking_mode, option.duration)
        if (priceCents === null || duration === null) throw new Error('validation')
        const periodPrices = draft.booking_mode === 'periods' ? {
          morning_price_cents: priceCents,
          afternoon_price_cents: priceToCents(option.afternoon_price),
          full_day_price_cents: priceToCents(option.full_day_price),
        } : {
          morning_price_cents: null,
          afternoon_price_cents: null,
          full_day_price_cents: null,
        }
        if (draft.booking_mode === 'periods'
          && Object.values(periodPrices).some((value) => value === null)) throw new Error('validation')
        return {
          id: option.id,
          size: size.code,
          price_cents: priceCents,
          duration_minutes: duration,
          ...periodPrices,
          is_active: true,
        }
      })
      if (!options.some((option) => option.is_active)) throw new Error('validation')
      let bookingSettings = {}
      if (draft.booking_mode === 'periods') {
        if (!isValidPeriodSettings(draft.settings)) throw new Error('validation')
        bookingSettings = {
          morning_start: draft.settings.morning_start,
          morning_end: draft.settings.morning_end,
          afternoon_start: draft.settings.afternoon_start,
          afternoon_end: draft.settings.afternoon_end,
        }
      } else if (draft.booking_mode === 'stay') {
        const checkIn = parseTimeRange(draft.settings.check_in_start, draft.settings.check_in_end)
        const checkOut = parseTimeRange(draft.settings.check_out_start, draft.settings.check_out_end)
        if (!checkIn || !checkOut) throw new Error('validation')
        bookingSettings = {
          check_in_start: checkIn.start,
          check_in_end: checkIn.end,
          check_out_start: checkOut.start,
          check_out_end: checkOut.end,
        }
      }
      await saveService(business.id, {
        ...draft,
        name: draft.name.trim(),
        booking_mode: normalizeBookingMode(draft.booking_mode),
      }, options, bookingSettings)
      setDraft(null)
      setServiceNotice('Serviço salvo. As alterações valem para novos agendamentos.')
      await load()
    } catch (error) {
      setServiceError(error.message === 'validation'
        ? 'Confira a categoria, o nome, os horários, os preços de cada modalidade e os portes selecionados.'
        : messageFor(error))
      await load()
    } finally {
      setSavingService(false)
    }
  }

  async function submitCategory(event) {
    event.preventDefault()
    if (savingCategory || !categoryDraft) return
    const name = categoryDraft.name.trim()
    const description = categoryDraft.description.trim()
    if (!name || name.length > 80 || description.length > 300) {
      setCategoryError('Confira o nome da categoria e a descrição (até 300 caracteres).')
      return
    }
    setSavingCategory(true)
    setCategoryError('')
    setCategoryNotice('')
    try {
      await saveServiceCategory(business.id, {
        ...categoryDraft,
        name,
        description,
        sort_order: state.categories.length,
      })
      setCategoryDraft(null)
      setCategoryNotice('Categoria salva.')
      await load()
    } catch (error) {
      setCategoryError(messageFor(error))
    } finally {
      setSavingCategory(false)
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

  async function confirmServiceReactivate() {
    if (!confirmAction || confirmBusy) return
    setConfirmBusy(true)
    setConfirmError('')
    try {
      await reactivateService(business.id, confirmAction.id)
      setConfirmAction(null)
      setServiceNotice('Serviço reativado e disponível para novas reservas.')
      await load()
    } catch (error) {
      setConfirmError(messageFor(error))
    } finally {
      setConfirmBusy(false)
    }
  }

  async function confirmCategoryDelete() {
    if (!confirmAction || confirmBusy) return
    setConfirmBusy(true)
    setConfirmError('')
    try {
      await deleteServiceCategory(confirmAction.id)
      setConfirmAction(null)
      setCategoryNotice('Categoria excluída.')
      await load()
    } catch (error) {
      setConfirmError(messageFor(error))
    } finally {
      setConfirmBusy(false)
    }
  }

  if (state.status === 'loading') return <p className="status" role="status">Carregando controle do estabelecimento…</p>
  if (state.status === 'error') return <section className="stack"><Notice tone="error">{state.message || ERROR_MESSAGES.NETWORK}</Notice><button className="btn btn-quiet" onClick={load}>Tentar novamente</button></section>

  const activeServiceCount = state.services.filter((service) => service.is_active && !service.archived_at).length
  const activeSizeCount = state.sizes.filter((size) => size.is_active).length

  return (
    <div className="control-page stack">
      <ProfileHeader
        name={profile?.name || business.name}
        logoPath={profile?.logo_path}
        busy={photoBusy}
        error={photoError}
        notice={photoNotice}
        onPickFile={changePhoto}
      />

      <div className="control-bars">
      <ControlBar icon={<IconProfile />} tone="peach" title="Perfil público" summary="Nome, WhatsApp e cor">
        <p className="muted">Nome e cor também aparecem na página de agendamento.</p>
        <form className="control-form" onSubmit={saveProfile}>
          <div className="field">
            <label htmlFor="business-name">Nome do estabelecimento</label>
            <input id="business-name" type="text" maxLength={80} required value={profileDraft.name}
              onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="business-contact-phone">WhatsApp do estabelecimento (opcional)</label>
            <input id="business-contact-phone" type="tel" inputMode="tel" autoComplete="tel"
              placeholder="(41) 99999-9999" value={profileDraft.contact_phone ?? ''}
              onChange={(event) => setProfileDraft((current) => ({
                ...current,
                contact_phone: maskPhone(event.target.value),
              }))} />
            <span className="hint">Este número aparece no link público para o cliente entrar em contato.</span>
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
      </ControlBar>

      <ControlBar icon={<IconClock />} tone="sage" title="Horário de funcionamento" summary="Dias e períodos">
        <BusinessHoursSection businessId={business.id} bare />
      </ControlBar>

      <ControlBar icon={<IconSizes />} tone="sand" title="Portes disponíveis" summary={countLabel(activeSizeCount, 'porte ativo', 'portes ativos')}>
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
      </ControlBar>

      <ControlBar icon={<IconTag />} tone="lilac" title="Categorias" summary={countLabel(state.categories.length, 'categoria', 'categorias')}>
        <p className="muted">As categorias agrupam os serviços exibidos no link de agendamento.</p>
        <button className="btn btn-primary add-service-button" type="button" onClick={() => {
          setCategoryDraft({ id: null, name: '', description: '' })
          setCategoryError('')
          setCategoryNotice('')
        }}>Adicionar categoria</button>
        {categoryNotice && <Notice>{categoryNotice}</Notice>}
        <ErrorNotice>{categoryError}</ErrorNotice>
        <div className="category-admin-list">
          {state.categories.map((category) => {
              const linkedCount = state.services.filter((service) => service.category_id === category.id).length
              const count = state.services.filter((service) => service.category_id === category.id
                && service.is_active && !service.archived_at).length
            return (
              <article className="category-admin-card" key={category.id}>
                <div>
                  <h3>{category.name}</h3>
                  <p className="muted">{category.description || 'Sem descrição'}</p>
                  <span className="small muted">{count} {count === 1 ? 'serviço ativo' : 'serviços ativos'}</span>
                </div>
                <button className="btn btn-quiet" type="button" onClick={() => {
                  setCategoryDraft({ id: category.id, name: category.name, description: category.description })
                  setCategoryError('')
                  setCategoryNotice('')
                }}>Editar categoria</button>
                <button className="btn-text" type="button" disabled={linkedCount > 0} title={linkedCount > 0 ? 'Mova ou exclua todos os serviços vinculados antes.' : undefined}
                  onClick={() => {
                    setConfirmError('')
                    setConfirmAction({ kind: 'category', id: category.id, name: category.name })
                  }}>Excluir categoria</button>
                {linkedCount > 0 && <span className="hint">Mova os {linkedCount} serviços vinculados antes de excluir.</span>}
              </article>
            )
          })}
        </div>
      </ControlBar>

      <ControlBar icon={<IconList />} tone="rose" title="Serviços para reserva" summary={countLabel(activeServiceCount, 'serviço ativo', 'serviços ativos')}>
        <button className="btn btn-primary add-service-button" type="button" onClick={() => {
          setDraft(newDraft(activeSizes, state.categories)); setServiceError(''); setServiceNotice('')
        }}>Adicionar serviço</button>
        {serviceNotice && <Notice>{serviceNotice}</Notice>}
        <ErrorNotice>{serviceError}</ErrorNotice>
        {state.services.length === 0 && <p className="muted">Nenhum serviço cadastrado ainda.</p>}
        {groupServicesByCategory(state.categories, state.services).map((category) => (
          <section className="service-category-group" key={category.id} aria-labelledby={`services-category-${category.id}`}>
            <h3 id={`services-category-${category.id}`}>{category.name}</h3>
            {category.services.length === 0
              ? <p className="muted small">Nenhum serviço nesta categoria.</p>
              : <div className="service-cards">
                {category.services.map((service) => (
                  <article className="service-card" key={service.id} data-archived={Boolean(service.archived_at)}>
                    <div className="service-card-top">
                      <div><h3>{service.name}</h3><p className="muted">{service.description || 'Sem descrição'}</p></div>
                      <div className="service-card-badges">
                        <span className="service-mode-badge" data-mode={normalizeBookingMode(service.booking_mode)}>
                          {BOOKING_MODE_LABELS[normalizeBookingMode(service.booking_mode)]}
                        </span>
                        {service.archived_at && <span className="booking-status">Arquivado</span>}
                      </div>
                    </div>
                    <ul className="service-option-summary">
                      {service.options.filter((option) => option.is_active).map((option) => {
                        const size = state.sizes.find((item) => item.code === option.size)
                        const daily = isDailyService(service)
                        const prices = [option.morning_price_cents, option.afternoon_price_cents, option.full_day_price_cents]
                        const periodSummary = prices.every((price) => price != null)
                          ? `manhã ${formatBRL(prices[0])} · tarde ${formatBRL(prices[1])} · integral ${formatBRL(prices[2])}`
                          : `${formatBRL(option.price_cents)}`
                        return <li key={option.id}><span>{size?.name ?? option.size}</span><span>{service.booking_mode === 'periods' ? periodSummary : daily ? 'por diária' : `${option.duration_minutes} min`}</span>{service.booking_mode !== 'periods' && <strong>{formatBRL(option.price_cents)}</strong>}</li>
                      })}
                    </ul>
                    <div className="service-card-actions">
                      {service.archived_at
                        ? <>
                          <button className="btn btn-quiet" type="button" onClick={() => editService(service)}>Editar</button>
                          <button className="btn btn-quiet" type="button" onClick={() => {
                            setConfirmError('')
                            setConfirmAction({ kind: 'service-reactivate', id: service.id, name: service.name })
                          }}>Reativar serviço</button>
                        </>
                        : <>
                      <button className="btn btn-quiet" type="button" onClick={() => editService(service)}>Editar</button>
                      <button className="btn-text" type="button" onClick={() => {
                        setConfirmError(''); setConfirmAction({ kind: 'service', id: service.id, name: service.name })
                      }}>Arquivar</button>
                        </>}
                    </div>
                  </article>
                ))}
              </div>}
          </section>
        ))}

        <dialog
          ref={serviceDialogRef}
          className="control-editor-dialog"
          aria-labelledby="service-editor-title"
          onCancel={(event) => {
            if (savingService) event.preventDefault()
            else setDraft(null)
          }}
        >
          {draft && <form className="service-editor stack" onSubmit={submitService}>
            <div className="control-section-heading">
              <h2 id="service-editor-title">{draft.id ? 'Editar serviço' : 'Novo serviço'}</h2>
              <button className="btn-text" type="button" onClick={() => setDraft(null)} disabled={savingService}>Fechar</button>
            </div>
            <div className="field"><label htmlFor="service-category">Categoria</label>
              <select id="service-category" required value={draft.category_id}
                onChange={(event) => setDraft((current) => ({ ...current, category_id: event.target.value }))}>
                <option value="" disabled>Selecione uma categoria</option>
                {state.categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
              {state.categories.length === 0 && <span className="hint">Adicione uma categoria antes de cadastrar serviços.</span>}
            </div>
            <div className="field"><label htmlFor="service-name">Nome do serviço</label>
              <input id="service-name" type="text" maxLength={80} required value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="field"><label htmlFor="service-description">Descrição</label>
              <textarea id="service-description" maxLength={300} value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></div>
            <fieldset className="booking-mode-picker">
              <legend>Como esse serviço é agendado?</legend>
              <div className="booking-mode-options">
                {[
                  { value: 'hourly', title: 'Por horário', hint: 'Banho, tosa e outros serviços com hora marcada e duração.' },
                  { value: 'periods', title: 'Por períodos', hint: 'Manhã, tarde ou integral, com capacidade compartilhada.' },
                  { value: 'stay', title: 'Entrada e saída', hint: 'Hospedagem com horários configuráveis e cobrança por duração.' },
                  ...(draft.booking_mode === 'daily'
                    ? [{ value: 'daily', title: 'Por diária (legado)', hint: 'Mantém o fluxo existente baseado apenas em datas.' }]
                    : []),
                ].map((mode) => (
                  <label className="booking-mode-option" key={mode.value} data-checked={draft.booking_mode === mode.value}>
                    <input type="radio" name="service-booking-mode" value={mode.value}
                      checked={draft.booking_mode === mode.value}
                      onChange={() => setDraft((current) => ({ ...current, booking_mode: mode.value }))} />
                    <span className="booking-mode-copy">
                      <strong>{mode.title}</strong>
                      <small>{mode.hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {draft.booking_mode === 'periods' && (
              <fieldset className="service-booking-settings stack-sm">
                <legend>Horários dos períodos</legend>
                <div className="service-settings-grid">
                  <div className="field"><label htmlFor="morning-start">Início da manhã</label>
                    <input id="morning-start" type="time" required value={draft.settings.morning_start}
                      onChange={(event) => setDraft((current) => ({ ...current, settings: { ...current.settings, morning_start: event.target.value } }))} /></div>
                  <div className="field"><label htmlFor="morning-end">Fim da manhã</label>
                    <input id="morning-end" type="time" required value={draft.settings.morning_end}
                      onChange={(event) => setDraft((current) => ({ ...current, settings: { ...current.settings, morning_end: event.target.value } }))} /></div>
                  <div className="field"><label htmlFor="afternoon-start">Início da tarde</label>
                    <input id="afternoon-start" type="time" required value={draft.settings.afternoon_start}
                      onChange={(event) => setDraft((current) => ({ ...current, settings: { ...current.settings, afternoon_start: event.target.value } }))} /></div>
                  <div className="field"><label htmlFor="afternoon-end">Fim da tarde</label>
                    <input id="afternoon-end" type="time" required value={draft.settings.afternoon_end}
                      onChange={(event) => setDraft((current) => ({ ...current, settings: { ...current.settings, afternoon_end: event.target.value } }))} /></div>
                </div>
                <p className="hint">O período integral combina o início da manhã com o fim da tarde. Os intervalos não podem se sobrepor.</p>
              </fieldset>
            )}
            {draft.booking_mode === 'stay' && (
              <fieldset className="service-booking-settings stack-sm">
                <legend>Intervalos de entrada e saída</legend>
                <div className="stay-dates">
                  <div className="field"><label htmlFor="stay-check-in-start">Início das entradas</label>
                    <input id="stay-check-in-start" type="time" required
                      value={draft.settings.check_in_start}
                      onChange={(event) => setDraft((current) => ({ ...current, settings: { ...current.settings, check_in_start: event.target.value } }))} /></div>
                  <div className="field"><label htmlFor="stay-check-in-end">Fim das entradas</label>
                    <input id="stay-check-in-end" type="time" required
                      value={draft.settings.check_in_end}
                      onChange={(event) => setDraft((current) => ({ ...current, settings: { ...current.settings, check_in_end: event.target.value } }))} /></div>
                  <div className="field"><label htmlFor="stay-check-out-start">Início das saídas</label>
                    <input id="stay-check-out-start" type="time" required
                      value={draft.settings.check_out_start}
                      onChange={(event) => setDraft((current) => ({ ...current, settings: { ...current.settings, check_out_start: event.target.value } }))} /></div>
                  <div className="field"><label htmlFor="stay-check-out-end">Fim das saídas</label>
                    <input id="stay-check-out-end" type="time" required
                      value={draft.settings.check_out_end}
                      onChange={(event) => setDraft((current) => ({ ...current, settings: { ...current.settings, check_out_end: event.target.value } }))} /></div>
                </div>
                <span className="hint">O cliente escolhe horários a cada 30 minutos dentro desses intervalos. A saída será após 12, 24, 36 horas ou múltiplos de 12 horas.</span>
              </fieldset>
            )}
            <fieldset className="service-size-options">
              <legend>{draft.booking_mode === 'periods'
                ? 'Portes atendidos e preços dos períodos'
                : ['daily', 'stay'].includes(draft.booking_mode)
                  ? 'Portes atendidos e preço da diária'
                  : 'Portes atendidos, preço e duração'}</legend>
              {activeSizes.map((size) => {
                const option = draft.options[size.code] ?? {
                  id: null, price: '', morning_price: '', afternoon_price: '', full_day_price: '',
                  duration: '30', enabled: false,
                }
                return <div className="service-size-editor" key={size.code}>
                  <label className="consent"><input type="checkbox" checked={option.enabled}
                    onChange={(event) => updateOption(size.code, 'enabled', event.target.checked)} /><span>{size.name}</span></label>
                  {option.enabled && <div className="size-price-duration" data-mode={draft.booking_mode}>
                    {draft.booking_mode === 'periods' ? <>
                      <div className="field"><label htmlFor={`morning-price-${size.code}`}>Preço da manhã (R$)</label>
                        <input id={`morning-price-${size.code}`} type="text" inputMode="decimal" required
                          value={option.morning_price} onChange={(event) => updateOption(size.code, 'morning_price', event.target.value)} /></div>
                      <div className="field"><label htmlFor={`afternoon-price-${size.code}`}>Preço da tarde (R$)</label>
                        <input id={`afternoon-price-${size.code}`} type="text" inputMode="decimal" required
                          value={option.afternoon_price} onChange={(event) => updateOption(size.code, 'afternoon_price', event.target.value)} /></div>
                      <div className="field"><label htmlFor={`full-day-price-${size.code}`}>Preço integral (R$)</label>
                        <input id={`full-day-price-${size.code}`} type="text" inputMode="decimal" required
                          value={option.full_day_price} onChange={(event) => updateOption(size.code, 'full_day_price', event.target.value)} /></div>
                    </> : <>
                    <div className="field"><label htmlFor={`price-${size.code}`}>{['daily', 'stay'].includes(draft.booking_mode) ? 'Preço da diária (R$)' : 'Preço (R$)'}</label>
                      <input id={`price-${size.code}`} type="text" inputMode="decimal" placeholder={['daily', 'stay'].includes(draft.booking_mode) ? '90,00' : '45,00'} required
                        value={option.price} onChange={(event) => updateOption(size.code, 'price', event.target.value)} /></div>
                    {draft.booking_mode === 'hourly' && <div className="field"><label htmlFor={`duration-${size.code}`}>Tempo (min)</label>
                      <input id={`duration-${size.code}`} type="number" min="5" max="720" step="1" required
                        value={option.duration} onChange={(event) => updateOption(size.code, 'duration', event.target.value)} /></div>}
                    </>}
                  </div>}
                </div>
              })}
            </fieldset>
            <p className="hint">{draft.booking_mode === 'periods'
              ? 'Cada período possui preço próprio e até quatro pets podem ocupar simultaneamente cada intervalo.'
              : draft.booking_mode === 'stay'
                ? '12 horas custam meia diária; cada bloco adicional de 12 horas soma meia diária. A capacidade é independente da agenda.'
                : draft.booking_mode === 'daily'
                  ? 'Este serviço mantém o fluxo de hospedagem antigo, baseado em datas e diárias.'
                  : 'O tempo configurado é usado pelo banco para reservar o intervalo correto na agenda.'}</p>
            <ErrorNotice>{serviceError}</ErrorNotice>
            <button className="btn btn-primary" type="submit" disabled={savingService || state.categories.length === 0}>
              {savingService ? 'Salvando serviço…' : 'Salvar serviço'}
            </button>
          </form>}
        </dialog>
      </ControlBar>
      </div>

      <dialog
        ref={categoryDialogRef}
        className="control-editor-dialog"
        aria-labelledby="category-editor-title"
        onCancel={(event) => {
          if (savingCategory) event.preventDefault()
          else setCategoryDraft(null)
        }}
      >
        {categoryDraft && <form className="service-editor stack" onSubmit={submitCategory}>
          <div className="control-section-heading">
            <h2 id="category-editor-title">{categoryDraft.id ? 'Editar categoria' : 'Nova categoria'}</h2>
            <button className="btn-text" type="button" onClick={() => setCategoryDraft(null)} disabled={savingCategory}>Fechar</button>
          </div>
          <div className="field"><label htmlFor="category-name">Nome da categoria</label>
            <input id="category-name" type="text" maxLength={80} required value={categoryDraft.name}
              onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} /></div>
          <div className="field"><label htmlFor="category-description">Descrição</label>
            <textarea id="category-description" maxLength={300} value={categoryDraft.description}
              onChange={(event) => setCategoryDraft((current) => ({ ...current, description: event.target.value }))} /></div>
          <ErrorNotice>{categoryError}</ErrorNotice>
          <button className="btn btn-primary" type="submit" disabled={savingCategory}>
            {savingCategory ? 'Salvando categoria…' : 'Salvar categoria'}
          </button>
        </form>}
      </dialog>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.kind === 'category'
          ? `Excluir a categoria “${confirmAction?.name}”?`
          : confirmAction?.kind === 'service'
            ? `Arquivar o serviço “${confirmAction?.name}”?`
            : confirmAction?.kind === 'service-reactivate'
              ? `Reativar o serviço “${confirmAction?.name}”?`
              : `${confirmAction?.is_active ? 'Desativar' : 'Reativar'} o porte “${confirmAction?.name}”?`}
        description={confirmAction?.kind === 'category'
          ? 'A categoria só pode ser excluída quando não tiver serviços vinculados.'
          : confirmAction?.kind === 'service'
            ? 'Ele deixará de aparecer para novas reservas. Agendamentos antigos continuarão preservados.'
            : confirmAction?.kind === 'service-reactivate'
              ? 'O serviço voltará a aparecer para novas reservas. Agendamentos antigos serão preservados.'
              : 'Essa alteração afeta quais portes podem ser reservados em todos os serviços.'}
        confirmLabel={confirmAction?.kind === 'category'
          ? 'Sim, excluir categoria'
          : confirmAction?.kind === 'service'
            ? 'Sim, arquivar serviço'
            : confirmAction?.kind === 'service-reactivate'
              ? 'Sim, reativar serviço'
              : confirmAction?.is_active ? 'Sim, desativar porte' : 'Sim, reativar porte'}
        busy={confirmBusy}
        error={confirmError}
        onCancel={() => { setConfirmAction(null); setConfirmError('') }}
        onConfirm={confirmAction?.kind === 'category'
          ? confirmCategoryDelete
          : confirmAction?.kind === 'service'
            ? confirmServiceArchive
            : confirmAction?.kind === 'service-reactivate'
              ? confirmServiceReactivate
              : () => toggleSize(confirmAction)}
      />
    </div>
  )
}

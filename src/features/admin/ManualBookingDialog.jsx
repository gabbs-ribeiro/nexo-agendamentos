import { useEffect, useMemo, useRef, useState } from 'react'
import Notice from '../../components/Notice.jsx'
import {
  createAdminBooking, createAdminPeriodBooking, createAdminTimedStay, getAvailableSlots, getPeriodQuote,
  getTimedStayOptions, listPublicBookingModels, listPublicServiceCategories, updateAdminBookingInternalNotes,
} from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { formatBRL, formatLongDate, isValidPhone, maskPhone } from '../../lib/format.js'
import { timeOptionsInRange } from '../../lib/timeRanges.js'
import { mergeBookingModels } from '../public-booking/catalogModels.js'
import { formatShortDate } from '../public-booking/stayDates.js'
import { chargeUnitsLabel } from '../public-booking/stayOptions.js'

const emptyForm = () => ({
  customerName: '',
  customerPhone: '',
  petName: '',
  petBreed: '',
  notes: '',
  internalNotes: '',
})

// O painel cria reservas dos tres modelos. O modelo por diaria (legado) continua so pelo link do cliente.
const SUPPORTED_MODES = ['hourly', 'periods', 'stay']
const MODE_LABELS = { hourly: 'Por horário', periods: 'Por períodos', stay: 'Entrada e saída' }
const PERIODS = [['morning', 'Manhã'], ['afternoon', 'Tarde'], ['full_day', 'Integral']]
const short = (time) => String(time ?? '').slice(0, 5)

export default function ManualBookingDialog({ open, business, initialDate, onCancel, onCreated, onUncertain }) {
  const dialogRef = useRef(null)
  const [catalog, setCatalog] = useState({ status: 'loading', categories: [], skippedLegacy: false })
  const [categoryId, setCategoryId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [optionId, setOptionId] = useState('')
  const [date, setDate] = useState(initialDate)
  // por horario
  const [slotsState, setSlotsState] = useState({ status: 'idle', slots: [] })
  const [startsAt, setStartsAt] = useState('')
  // por periodos
  const [period, setPeriod] = useState('morning')
  const [quoteState, setQuoteState] = useState({ status: 'idle' })
  // entrada e saida
  const [entryTime, setEntryTime] = useState('')
  const [stayState, setStayState] = useState({ status: 'idle' })
  const [exitKey, setExitKey] = useState('')

  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)

  const category = catalog.categories.find((item) => item.category_id === categoryId)
  const service = category?.services.find((item) => item.service_id === serviceId)
  const option = service?.options.find((item) => item.option_id === optionId)
  const mode = service?.booking_mode
  const settings = service?.booking_settings
  const selectedSlot = slotsState.slots.find((slot) => slot.starts_at === startsAt)
  const quote = quoteState.status === 'ready' ? quoteState.data : null
  const stayOptions = stayState.status === 'ready' ? stayState.data.options : []
  const selectedExit = stayOptions.find((item) => `${item.check_out}|${item.check_out_time}` === exitKey)
  const checkInTimes = useMemo(
    () => timeOptionsInRange(settings?.check_in_start, settings?.check_in_end),
    [settings?.check_in_start, settings?.check_in_end],
  )
  const exitGroups = useMemo(() => {
    const groups = new Map()
    for (const item of stayOptions) {
      if (!groups.has(item.check_out)) groups.set(item.check_out, [])
      groups.get(item.check_out).push(item)
    }
    return [...groups.entries()]
  }, [stayOptions])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function resetChoice() {
    setStartsAt('')
    setPeriod('morning')
    setEntryTime('')
    setExitKey('')
    setError('')
  }

  useEffect(() => {
    if (!open) return undefined
    let active = true
    setCatalog({ status: 'loading', categories: [], skippedLegacy: false })
    setDate(initialDate)
    setCategoryId('')
    setServiceId('')
    setOptionId('')
    resetChoice()
    setForm(emptyForm())
    setSubmissionUncertain(false)
    Promise.all([listPublicServiceCategories(business.slug), listPublicBookingModels(business.slug)])
      .then(([categories, models]) => {
        if (!active) return
        let skippedLegacy = false
        const usable = categories
          .map((item) => ({
            ...item,
            services: mergeBookingModels(item.services, models).filter((svc) => {
              if (svc.booking_mode === 'daily') skippedLegacy = true
              return SUPPORTED_MODES.includes(svc.booking_mode) && svc.options.length > 0
            }),
          }))
          .filter((item) => item.services.length > 0)
        setCatalog({ status: 'ready', categories: usable, skippedLegacy })
        const firstService = usable[0]?.services[0]
        setCategoryId(usable[0]?.category_id ?? '')
        setServiceId(firstService?.service_id ?? '')
        setOptionId(firstService?.options[0]?.option_id ?? '')
      })
      .catch((err) => {
        if (active) setCatalog({ status: 'error', categories: [], message: messageFor(err), skippedLegacy: false })
      })
    return () => { active = false }
  }, [open, business.slug, initialDate])

  // Por horario: horarios livres do dia
  useEffect(() => {
    if (!open || mode !== 'hourly' || !optionId || !date) {
      setSlotsState({ status: 'idle', slots: [] })
      setStartsAt('')
      return undefined
    }
    let active = true
    setSlotsState({ status: 'loading', slots: [] })
    setStartsAt('')
    getAvailableSlots(business.slug, optionId, date)
      .then((slots) => { if (active) setSlotsState({ status: 'ready', slots }) })
      .catch((err) => { if (active) setSlotsState({ status: 'error', slots: [], message: messageFor(err) }) })
    return () => { active = false }
  }, [open, business.slug, mode, optionId, date])

  // Por periodos: valor e vagas do periodo escolhido
  useEffect(() => {
    if (!open || mode !== 'periods' || !optionId || !date || !period) {
      setQuoteState({ status: 'idle' })
      return undefined
    }
    let active = true
    setQuoteState({ status: 'loading' })
    getPeriodQuote(business.slug, optionId, date, period)
      .then((data) => { if (active) setQuoteState({ status: 'ready', data }) })
      .catch((err) => { if (active) setQuoteState({ status: 'error', message: messageFor(err) }) })
    return () => { active = false }
  }, [open, business.slug, mode, optionId, date, period])

  // Entrada e saida: opcoes de saida a partir da entrada
  useEffect(() => {
    if (!open || mode !== 'stay' || !optionId || !date || !entryTime) {
      setStayState({ status: 'idle' })
      setExitKey('')
      return undefined
    }
    let active = true
    setStayState({ status: 'loading' })
    setExitKey('')
    getTimedStayOptions(business.slug, optionId, date, entryTime)
      .then((data) => { if (active) setStayState({ status: 'ready', data }) })
      .catch((err) => { if (active) setStayState({ status: 'error', message: messageFor(err) }) })
    return () => { active = false }
  }, [open, business.slug, mode, optionId, date, entryTime])

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function chooseService(nextService) {
    setServiceId(nextService?.service_id ?? '')
    setOptionId(nextService?.options[0]?.option_id ?? '')
    resetChoice()
  }

  function changeCategory(nextId) {
    const nextCategory = catalog.categories.find((item) => item.category_id === nextId)
    setCategoryId(nextId)
    chooseService(nextCategory?.services[0])
  }

  const ready = (
    (mode === 'hourly' && selectedSlot)
    || (mode === 'periods' && quote?.available === true)
    || (mode === 'stay' && selectedExit?.available === true)
  )
  function summaryText() {
    if (!ready || !service || !option) return ''
    const head = `${service.name} · ${option.size_label}`
    if (mode === 'hourly') return `${head} · ${selectedSlot.local_time} · ${option.duration_minutes} min · ${formatBRL(option.price_cents)}`
    if (mode === 'periods') {
      const label = PERIODS.find(([value]) => value === period)?.[1]
      return `${head} · ${formatLongDate(date)} · ${label} (${quote.local_start}–${quote.local_end}) · ${formatBRL(quote.price_cents)}`
    }
    return `${head} · ${formatShortDate(date)} ${entryTime} → ${formatShortDate(selectedExit.check_out)} ${selectedExit.check_out_time} · ${chargeUnitsLabel(selectedExit.charge_units)} · ${formatBRL(selectedExit.total_price_cents)}`
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || !service || !option || !ready) return
    if (!isValidPhone(form.customerPhone)) {
      setError('Informe um telefone válido com DDD.')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (mode === 'hourly') {
        const created = await createAdminBooking(business.id, option.option_id, selectedSlot.starts_at, form)
        let internalNoteSaved = true
        if (form.internalNotes.trim()) {
          try {
            await updateAdminBookingInternalNotes(created.booking_ref, form.internalNotes.trim())
          } catch {
            internalNoteSaved = false
          }
        }
        onCreated({ bookingId: created.booking_ref, internalNoteSaved })
      } else if (mode === 'periods') {
        await createAdminPeriodBooking(business.id, { optionId: option.option_id, date, period }, form)
        onCreated({ internalNoteSaved: true, label: `creche em ${formatShortDate(date)}`, date })
      } else {
        await createAdminTimedStay(business.id, {
          optionId: option.option_id, checkIn: date, entryTime, checkOut: selectedExit.check_out, exitTime: selectedExit.check_out_time,
        }, form)
        onCreated({ internalNoteSaved: true, label: `hospedagem de ${formatShortDate(date)} a ${formatShortDate(selectedExit.check_out)}`, date })
      }
    } catch (err) {
      const message = messageFor(err)
      if (err.code === 'NETWORK') {
        setSubmissionUncertain(true)
        setError(`${message} A criação pode ter sido concluída; confira a agenda antes de tentar novamente.`)
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  function handleCancel(event) {
    event.preventDefault()
    if (busy) return
    if (submissionUncertain) onUncertain()
    else onCancel()
  }

  const dateLabel = mode === 'stay' ? 'Data de entrada' : mode === 'periods' ? 'Data da creche' : 'Data'

  return (
    <dialog
      ref={dialogRef}
      className="manual-booking-dialog"
      aria-labelledby="manual-booking-title"
      onCancel={handleCancel}
    >
      <form className="stack" onSubmit={submit}>
        <div className="manual-booking-heading">
          <div className="stack-sm">
            <p className="eyebrow">Novo compromisso</p>
            <h2 id="manual-booking-title">Adicionar agendamento</h2>
          </div>
          <button type="button" className="btn-text"
            onClick={submissionUncertain ? onUncertain : onCancel} disabled={busy}>Fechar</button>
        </div>

        {catalog.status === 'loading' && <p className="status" role="status">Carregando serviços…</p>}
        {catalog.status === 'error' && <Notice tone="error">{catalog.message}</Notice>}
        {catalog.status === 'ready' && catalog.categories.length === 0 && (
          <Notice>Não há serviços ativos disponíveis para agendar pelo painel.</Notice>
        )}

        {catalog.status === 'ready' && catalog.categories.length > 0 && (
          <>
            <section className="manual-section" aria-labelledby="manual-service-title">
              <h3 id="manual-service-title">1. Serviço</h3>
              <p className="manual-label" id="manual-category-label">Categoria</p>
              <div className="manual-chip-row" role="group" aria-labelledby="manual-category-label">
                {catalog.categories.map((item) => (
                  <button key={item.category_id} type="button" className="manual-chip"
                    aria-pressed={item.category_id === categoryId} onClick={() => changeCategory(item.category_id)}>
                    {item.name}
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="manual-service">Serviço</label>
                <select id="manual-service" required value={serviceId}
                  onChange={(event) => chooseService(category.services.find((item) => item.service_id === event.target.value))}>
                  {category?.services.map((item) => (
                    <option key={item.service_id} value={item.service_id}>{item.name}</option>
                  ))}
                </select>
              </div>
              {service && <p className="manual-mode-tag" data-mode={mode}>{MODE_LABELS[mode]}</p>}
              <div className="field">
                <label htmlFor="manual-size">{mode === 'hourly' ? 'Porte e valor' : 'Porte'}</label>
                <select id="manual-size" required value={optionId}
                  onChange={(event) => { setOptionId(event.target.value); resetChoice() }}>
                  {service?.options.map((item) => (
                    <option key={item.option_id} value={item.option_id}>
                      {mode === 'hourly'
                        ? `${item.size_label} · ${formatBRL(item.price_cents)} · ${item.duration_minutes} min`
                        : mode === 'stay'
                          ? `${item.size_label} · ${formatBRL(item.price_cents)} por diária`
                          : item.size_label}
                    </option>
                  ))}
                </select>
              </div>
              {service?.description && <p className="muted small">{service.description}</p>}
              {catalog.skippedLegacy && (
                <p className="muted small">Serviços por diária (legado) não aparecem aqui: o cliente os reserva pelo link.</p>
              )}
            </section>

            <section className="manual-section" aria-labelledby="manual-when-title">
              <h3 id="manual-when-title">2. Quando</h3>
              <div className="field">
                <label htmlFor="manual-date">{dateLabel}</label>
                <input id="manual-date" type="date" required value={date}
                  onChange={(event) => { setDate(event.target.value); setExitKey('') }} />
              </div>

              {mode === 'hourly' && (
                <fieldset className="field">
                  <legend>Horário disponível</legend>
                  {slotsState.status === 'loading' && <p className="muted" role="status">Buscando horários…</p>}
                  {slotsState.status === 'error' && <Notice tone="error">{slotsState.message}</Notice>}
                  {slotsState.status === 'ready' && slotsState.slots.length === 0 && (
                    <p className="muted">Não há horários livres para este serviço nesta data.</p>
                  )}
                  {slotsState.status === 'ready' && slotsState.slots.length > 0 && (
                    <div className="manual-slot-grid">
                      {slotsState.slots.map((slot) => (
                        <button key={slot.starts_at} type="button" className="manual-slot"
                          aria-pressed={startsAt === slot.starts_at} onClick={() => setStartsAt(slot.starts_at)}>
                          {slot.local_time}
                        </button>
                      ))}
                    </div>
                  )}
                </fieldset>
              )}

              {mode === 'periods' && (
                <fieldset className="field">
                  <legend>Período</legend>
                  <div className="manual-period-grid">
                    {PERIODS.map(([value, label]) => {
                      const start = value === 'afternoon' ? settings?.afternoon_start : settings?.morning_start
                      const end = value === 'morning' ? settings?.morning_end : settings?.afternoon_end
                      return (
                        <button key={value} type="button" className="manual-period"
                          aria-pressed={period === value} onClick={() => setPeriod(value)}>
                          <strong>{label}</strong>
                          {start && end && <span>{short(start)}–{short(end)}</span>}
                        </button>
                      )
                    })}
                  </div>
                  {quoteState.status === 'loading' && <p className="muted" role="status">Consultando vagas…</p>}
                  {quoteState.status === 'error' && <Notice tone="error">{quoteState.message}</Notice>}
                  {quote && quote.available === false && <Notice tone="error">Sem vagas neste período. Escolha outro período ou dia.</Notice>}
                  {quote && quote.available === true && (
                    <p className="manual-quote" aria-live="polite">
                      {quote.local_start}–{quote.local_end} · <strong>{formatBRL(quote.price_cents)}</strong>
                    </p>
                  )}
                </fieldset>
              )}

              {mode === 'stay' && (
                <>
                  <div className="field">
                    <label htmlFor="manual-entry-time">Horário de entrada</label>
                    <select id="manual-entry-time" required value={entryTime} onChange={(event) => setEntryTime(event.target.value)}>
                      <option value="">Selecione</option>
                      {checkInTimes.map((time) => <option key={time} value={time}>{time}</option>)}
                    </select>
                    {settings && <span className="hint">Entrada das {short(settings.check_in_start)} às {short(settings.check_in_end)}.</span>}
                  </div>
                  {stayState.status === 'loading' && <p className="muted" role="status">Consultando saídas e vagas…</p>}
                  {stayState.status === 'error' && <Notice tone="error">{stayState.message}</Notice>}
                  {stayState.status === 'ready' && (
                    <div className="field">
                      <label htmlFor="manual-exit">Saída (data, horário e valor)</label>
                      <select id="manual-exit" required value={exitKey} onChange={(event) => setExitKey(event.target.value)}>
                        <option value="">Selecione</option>
                        {exitGroups.map(([exitDate, items]) => (
                          <optgroup key={exitDate} label={formatLongDate(exitDate)}>
                            {items.map((item) => (
                              <option key={`${item.check_out}|${item.check_out_time}`} value={`${item.check_out}|${item.check_out_time}`}
                                disabled={!item.available}>
                                {item.check_out_time} · {chargeUnitsLabel(item.charge_units)} · {formatBRL(item.total_price_cents)}{item.available ? '' : ' · sem vaga'}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <span className="hint">A saída acontece no mesmo horário da entrada ou 12 horas antes/depois dele.</span>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="manual-section" aria-labelledby="manual-customer-title">
              <h3 id="manual-customer-title">3. Tutor e pet</h3>
              <div className="field">
                <label htmlFor="manual-customer-name">Nome do tutor</label>
                <input id="manual-customer-name" type="text" autoComplete="name" minLength={2} maxLength={100}
                  required value={form.customerName} onChange={(event) => updateField('customerName', event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="manual-customer-phone">Telefone com DDD</label>
                <input id="manual-customer-phone" type="tel" inputMode="tel" autoComplete="tel"
                  required value={form.customerPhone}
                  onChange={(event) => updateField('customerPhone', maskPhone(event.target.value))} />
              </div>
              <div className="field">
                <label htmlFor="manual-pet-name">Nome do animal</label>
                <input id="manual-pet-name" type="text" maxLength={60} required value={form.petName}
                  onChange={(event) => updateField('petName', event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="manual-pet-breed">Raça (opcional)</label>
                <input id="manual-pet-breed" type="text" maxLength={60} value={form.petBreed}
                  onChange={(event) => updateField('petBreed', event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="manual-notes">Observações do tutor (opcional)</label>
                <textarea id="manual-notes" maxLength={500} value={form.notes}
                  onChange={(event) => updateField('notes', event.target.value)} />
              </div>
              {mode === 'hourly' && (
                <div className="field">
                  <label htmlFor="manual-internal-notes">Anotação interna (opcional)</label>
                  <textarea id="manual-internal-notes" maxLength={2000} value={form.internalNotes}
                    onChange={(event) => updateField('internalNotes', event.target.value)} />
                  <p className="hint">Visível somente para a equipe do estabelecimento.</p>
                </div>
              )}
            </section>
          </>
        )}

        {ready && (
          <p className="manual-booking-summary" aria-live="polite">
            {summaryText()}
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="manual-booking-actions">
          <button type="button" className="btn btn-quiet"
            onClick={submissionUncertain ? onUncertain : onCancel} disabled={busy}>
            {submissionUncertain ? 'Fechar e conferir agenda' : 'Voltar'}
          </button>
          <button type="submit" className="btn btn-primary"
            disabled={busy || submissionUncertain || catalog.status !== 'ready' || !ready}>
            {busy ? 'Salvando…' : 'Criar agendamento'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

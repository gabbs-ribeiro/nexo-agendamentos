import { useEffect, useMemo, useRef, useState } from 'react'
import Notice from '../../components/Notice.jsx'
import { createAdminBooking, getAvailableSlots, listPublicServices, updateAdminBookingInternalNotes } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { isValidPhone, maskPhone } from '../../lib/format.js'

const emptyForm = () => ({
  customerName: '',
  customerPhone: '',
  petName: '',
  petBreed: '',
  notes: '',
  internalNotes: '',
})

export default function ManualBookingDialog({ open, business, initialDate, onCancel, onCreated, onUncertain }) {
  const dialogRef = useRef(null)
  const [servicesState, setServicesState] = useState({ status: 'loading', services: [] })
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [date, setDate] = useState(initialDate)
  const [slotsState, setSlotsState] = useState({ status: 'idle', slots: [] })
  const [startsAt, setStartsAt] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)

  const selectedService = servicesState.services.find((service) => service.service_id === selectedServiceId)
  const selectedOption = selectedService?.options.find((option) => option.option_id === selectedOptionId)
  const selectedSlot = slotsState.slots.find((slot) => slot.starts_at === startsAt)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    let active = true
    setServicesState({ status: 'loading', services: [] })
    setDate(initialDate)
    setStartsAt('')
    setSelectedServiceId('')
    setSelectedOptionId('')
    setForm(emptyForm())
    setError('')
    setSubmissionUncertain(false)
    listPublicServices(business.slug)
      .then((services) => {
        if (!active) return
        setServicesState({ status: 'ready', services })
        const firstService = services.find((service) => service.options.length > 0)
        setSelectedServiceId(firstService?.service_id ?? '')
        setSelectedOptionId(firstService?.options[0]?.option_id ?? '')
      })
      .catch((err) => {
        if (active) setServicesState({ status: 'error', services: [], message: messageFor(err) })
      })
    return () => { active = false }
  }, [open, business.slug, initialDate])

  useEffect(() => {
    if (!open || !selectedOptionId || !date) {
      setSlotsState({ status: 'idle', slots: [] })
      setStartsAt('')
      return undefined
    }
    let active = true
    setSlotsState({ status: 'loading', slots: [] })
    setStartsAt('')
    getAvailableSlots(business.slug, selectedOptionId, date)
      .then((slots) => {
        if (active) setSlotsState({ status: 'ready', slots })
      })
      .catch((err) => {
        if (active) setSlotsState({ status: 'error', slots: [], message: messageFor(err) })
      })
    return () => { active = false }
  }, [open, business.slug, selectedOptionId, date])

  const optionsByService = useMemo(
    () => servicesState.services.find((service) => service.service_id === selectedServiceId)?.options ?? [],
    [servicesState.services, selectedServiceId],
  )

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function changeService(serviceId) {
    const service = servicesState.services.find((item) => item.service_id === serviceId)
    setSelectedServiceId(serviceId)
    setSelectedOptionId(service?.options[0]?.option_id ?? '')
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || !selectedService || !selectedOption || !selectedSlot) return
    if (!isValidPhone(form.customerPhone)) {
      setError('Informe um telefone válido com DDD.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await createAdminBooking(business.id, selectedOption.option_id, selectedSlot.starts_at, form)
      let internalNoteSaved = true
      if (form.internalNotes.trim()) {
        try {
          await updateAdminBookingInternalNotes(created.booking_ref, form.internalNotes.trim())
        } catch {
          internalNoteSaved = false
        }
      }
      onCreated({ bookingId: created.booking_ref, internalNoteSaved })
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
    if (busy) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    if (submissionUncertain) onUncertain()
    else onCancel()
  }

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

        {servicesState.status === 'loading' && <p className="status" role="status">Carregando serviços…</p>}
        {servicesState.status === 'error' && <Notice tone="error">{servicesState.message}</Notice>}
        {servicesState.status === 'ready' && servicesState.services.length === 0 && (
          <Notice>Não há serviços ativos com horários disponíveis.</Notice>
        )}

        {servicesState.status === 'ready' && servicesState.services.length > 0 && (
          <>
            <div className="field">
              <label htmlFor="manual-service">Serviço</label>
              <select id="manual-service" required value={selectedServiceId} onChange={(event) => changeService(event.target.value)}>
                {servicesState.services.map((service) => (
                  <option key={service.service_id} value={service.service_id}>{service.name}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="manual-size">Porte e valor</label>
              <select id="manual-size" required value={selectedOptionId}
                onChange={(event) => setSelectedOptionId(event.target.value)}>
                {optionsByService.map((option) => (
                  <option key={option.option_id} value={option.option_id}>
                    {option.size_label} · {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(option.price_cents / 100)} · {option.duration_minutes} min
                  </option>
                ))}
              </select>
            </div>

            {selectedService?.description && <p className="muted small">{selectedService.description}</p>}

            <div className="field">
              <label htmlFor="manual-date">Data</label>
              <input id="manual-date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
            </div>

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
                      aria-pressed={startsAt === slot.starts_at}
                      onClick={() => setStartsAt(slot.starts_at)}>
                      {slot.local_time}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

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
            <div className="field">
              <label htmlFor="manual-internal-notes">Anotação interna (opcional)</label>
              <textarea id="manual-internal-notes" maxLength={2000} value={form.internalNotes}
                onChange={(event) => updateField('internalNotes', event.target.value)} />
              <p className="hint">Visível somente para a equipe do estabelecimento.</p>
            </div>
          </>
        )}

        {selectedSlot && selectedOption && (
          <p className="manual-booking-summary">
            {selectedService?.name} · {selectedOption.size_label} · {selectedSlot.local_time} · {selectedOption.duration_minutes} min
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="manual-booking-actions">
          <button type="button" className="btn btn-quiet"
            onClick={submissionUncertain ? onUncertain : onCancel} disabled={busy}>
            {submissionUncertain ? 'Fechar e conferir agenda' : 'Voltar'}
          </button>
          <button type="submit" className="btn btn-primary"
            disabled={busy || submissionUncertain || servicesState.status !== 'ready' || !selectedSlot}>
            {busy ? 'Salvando…' : 'Criar agendamento'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

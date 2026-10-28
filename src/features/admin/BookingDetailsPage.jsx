import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import Notice from '../../components/Notice.jsx'
import {
  getAdminBooking,
  setAdminBookingStatus,
  updateAdminBookingDetails,
  updateAdminBookingInternalNotes,
} from '../../lib/api.js'
import { ERROR_MESSAGES, messageFor } from '../../lib/errors.js'
import { whatsappUrl } from '../../lib/format.js'
import { bookingDetails, canCancelBooking } from './bookingView.js'
import { useAdminBusiness } from './AdminBusinessContext.jsx'
import TransportPanel from '../transport/TransportPanel.jsx'
import { bookingSummary } from '../transport/reservationSummary.js'
import { totalWithTransport } from '../transport/transportCalc.js'
import { useTransportRequests } from '../transport/useTransport.js'
import { formatBRL } from '../../lib/format.js'

function DetailSection({ title, children }) {
  return (
    <section className="detail-section stack-sm">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function DetailRows({ rows }) {
  return (
    <dl className="detail-rows">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function BookingDetailsPage() {
  const { bookingId } = useParams()
  const business = useAdminBusiness()
  const [state, setState] = useState({ status: 'loading' })
  const [edit, setEdit] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [detailsSuccess, setDetailsSuccess] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesError, setNotesError] = useState('')
  const [notesSuccess, setNotesSuccess] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [cancelSuccess, setCancelSuccess] = useState('')
  const transport = useTransportRequests('booking', [bookingId])

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const booking = await getAdminBooking(business.id, bookingId)
      if (!booking) {
        setState({ status: 'notfound' })
        return
      }
      setInternalNotes(booking.internal_notes ?? '')
      setState({ status: 'ready', booking })
    } catch {
      setState({ status: 'error' })
    }
  }, [business.id, bookingId])

  useEffect(() => { load() }, [load])

  function updateField(name, value) {
    setState((current) => current.status === 'ready'
      ? { ...current, booking: { ...current.booking, [name]: value } }
      : current)
  }

  async function saveDetails(event) {
    event.preventDefault()
    if (state.status !== 'ready' || savingDetails) return
    setSavingDetails(true)
    setDetailsError('')
    setDetailsSuccess('')
    try {
      await updateAdminBookingDetails(state.booking)
      setEdit(false)
      setDetailsSuccess('Informações salvas.')
      await load()
    } catch (error) {
      setDetailsError(messageFor(error))
    } finally {
      setSavingDetails(false)
    }
  }

  async function saveInternalNotes(event) {
    event.preventDefault()
    if (state.status !== 'ready' || savingNotes) return
    setSavingNotes(true)
    setNotesError('')
    setNotesSuccess('')
    try {
      await updateAdminBookingInternalNotes(state.booking.id, internalNotes)
      setNotesSuccess('Anotações salvas.')
    } catch (error) {
      setNotesError(messageFor(error))
    } finally {
      setSavingNotes(false)
    }
  }

  async function cancelBooking() {
    if (state.status !== 'ready' || cancelBusy || !canCancelBooking(state.booking.status)) return
    setCancelBusy(true)
    setCancelError('')
    setCancelSuccess('')
    try {
      await setAdminBookingStatus(state.booking.id, 'cancelled')
      setState((current) => current.status === 'ready'
        ? { ...current, booking: { ...current.booking, status: 'cancelled' } }
        : current)
      setConfirmCancel(false)
      setCancelSuccess('Agendamento cancelado. O horário foi liberado.')
    } catch (error) {
      setCancelError(messageFor(error))
    } finally {
      setCancelBusy(false)
    }
  }

  if (state.status === 'loading') {
    return <p className="status" role="status">Carregando detalhes do agendamento…</p>
  }
  if (state.status === 'error') {
    return <Notice tone="error">{ERROR_MESSAGES.NETWORK}</Notice>
  }
  if (state.status === 'notfound') {
    return (
      <section className="stack">
        <Notice tone="error">{ERROR_MESSAGES.NOT_FOUND}</Notice>
        <Link className="btn btn-quiet" to="/admin">Voltar à agenda</Link>
      </section>
    )
  }

  const booking = state.booking
  const view = bookingDetails(booking, business.timezone)
  const whatsapp = whatsappUrl(booking.customer_phone)

  return (
    <article className="stack">
      <div className="detail-heading">
        <div className="stack-sm">
          <Link to="/admin" className="btn-text">Voltar à agenda</Link>
          <h1>Detalhes do agendamento</h1>
          <span className={`booking-status booking-status-${booking.status}`}>{view.status}</span>
        </div>
      </div>

      {cancelSuccess && <Notice>{cancelSuccess}</Notice>}
      {detailsSuccess && <Notice>{detailsSuccess}</Notice>}

      <DetailSection title="Atendimento">
        <DetailRows rows={[
          ['Serviço contratado', view.service],
          ['Porte do animal', view.size],
          ['Data', view.date],
          ['Horário', `${view.start}–${view.end}`],
          ['Duração registrada', view.duration],
          ['Preço registrado', view.price],
          ...(transport.map[booking.id]?.status === 'confirmed' ? [
            ['Leva e traz', formatBRL(transport.map[booking.id].freight_cents)],
            ['Total com leva e traz', formatBRL(totalWithTransport(booking.price_cents, transport.map[booking.id]))],
          ] : []),
          ['Situação', view.status],
        ]} />
      </DetailSection>

      {transport.available && (
        <DetailSection title="Leva e traz">
          <TransportPanel
            kind="booking"
            reservation={bookingSummary(booking, business.timezone)}
            request={transport.map[booking.id]}
            onChanged={transport.reload}
            defaultOpen={Boolean(transport.map[booking.id]) && transport.map[booking.id].status !== 'cancelled'}
          />
        </DetailSection>
      )}

      <DetailSection title="Animal">
        {edit ? (
          <div className="detail-edit-fields">
            <div className="field">
              <label htmlFor="booking-pet-name">Nome</label>
              <input id="booking-pet-name" type="text" maxLength={60} required
                value={booking.pet_name} onChange={(event) => updateField('pet_name', event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="booking-pet-breed">Raça</label>
              <input id="booking-pet-breed" type="text" maxLength={60}
                value={booking.pet_breed ?? ''} onChange={(event) => updateField('pet_breed', event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="booking-notes">Informações do tutor</label>
              <textarea id="booking-notes" maxLength={500}
                value={booking.notes ?? ''} onChange={(event) => updateField('notes', event.target.value)} />
            </div>
          </div>
        ) : (
          <DetailRows rows={[
            ['Nome', booking.pet_name],
            ['Raça', booking.pet_breed],
            ['Observações informadas', booking.notes],
          ]} />
        )}
      </DetailSection>

      <DetailSection title="Tutor">
        {edit ? (
          <div className="detail-edit-fields">
            <div className="field">
              <label htmlFor="booking-customer-name">Nome</label>
              <input id="booking-customer-name" type="text" minLength={2} maxLength={100} required
                value={booking.customer_name} onChange={(event) => updateField('customer_name', event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="booking-customer-phone">Telefone</label>
              <input id="booking-customer-phone" type="tel" inputMode="tel" required
                value={booking.customer_phone} onChange={(event) => updateField('customer_phone', event.target.value)} />
            </div>
          </div>
        ) : (
          <DetailRows rows={[
            ['Nome', booking.customer_name],
            ['Telefone', booking.customer_phone],
          ]} />
        )}
        {whatsapp && (
          <a className="btn btn-quiet" href={whatsapp} target="_blank" rel="noopener noreferrer">
            Conversar com o tutor no WhatsApp
          </a>
        )}
      </DetailSection>

      {edit && (
        <form className="detail-actions" onSubmit={saveDetails}>
          {detailsError && <Notice tone="error">{detailsError}</Notice>}
          <button type="submit" className="btn btn-primary" disabled={savingDetails}>
            {savingDetails ? 'Salvando…' : 'Salvar informações'}
          </button>
          <button type="button" className="btn btn-quiet" disabled={savingDetails}
            onClick={() => { setEdit(false); load(); setDetailsError('') }}>
            Descartar alterações
          </button>
        </form>
      )}

      {!edit && (
        <button type="button" className="btn btn-quiet" onClick={() => { setDetailsSuccess(''); setEdit(true) }}>
          Editar informações permitidas
        </button>
      )}

      <DetailSection title="Anotações internas">
        <form className="stack-sm" onSubmit={saveInternalNotes}>
          <div className="field">
            <label htmlFor="booking-internal-notes">Anotações (visíveis somente à equipe)</label>
            <textarea id="booking-internal-notes" maxLength={2000} value={internalNotes}
              onChange={(event) => setInternalNotes(event.target.value)} />
          </div>
          {notesError && <Notice tone="error">{notesError}</Notice>}
          {notesSuccess && <Notice>{notesSuccess}</Notice>}
          <button type="submit" className="btn btn-primary" disabled={savingNotes}>
            {savingNotes ? 'Salvando…' : 'Salvar anotações'}
          </button>
        </form>
      </DetailSection>

      {canCancelBooking(booking.status) && (
        <button type="button" className="btn btn-danger"
          onClick={() => { setCancelError(''); setConfirmCancel(true) }}>
          Cancelar agendamento
        </button>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar agendamento?"
        confirmLabel="Sim, cancelar agendamento"
        busy={cancelBusy}
        error={cancelError}
        onCancel={() => { setConfirmCancel(false); setCancelError('') }}
        onConfirm={cancelBooking}
      >
        <p>Deseja realmente cancelar o agendamento de <strong>{booking.pet_name}</strong>?</p>
        <p>{view.date}, das {view.start} às {view.end}.</p>
      </ConfirmDialog>
    </article>
  )
}

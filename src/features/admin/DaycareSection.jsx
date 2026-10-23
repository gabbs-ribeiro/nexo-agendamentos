import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import Notice from '../../components/Notice.jsx'
import { listAdminDaycareOnDate, setAdminDaycareStatus } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { formatBRL, formatInstant } from '../../lib/format.js'

const PERIOD_LABELS = { morning: 'Manhã', afternoon: 'Tarde', full_day: 'Integral' }

export default function DaycareSection({ business, date }) {
  const [state, setState] = useState({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(() => setReload((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    listAdminDaycareOnDate(business.id, date)
      .then((bookings) => { if (active) setState({ status: 'ready', bookings }) })
      .catch((err) => { if (active) setState({ status: 'error', message: messageFor(err) }) })
    return () => { active = false }
  }, [business.id, date, reload])

  async function confirm() {
    if (!target || busy) return
    setBusy(true)
    setError('')
    try {
      await setAdminDaycareStatus(target.booking.id, target.kind === 'cancel' ? 'cancelled' : 'completed')
      setNotice(target.kind === 'cancel' ? 'Reserva da creche cancelada. A capacidade foi liberada.' : 'Reserva da creche concluída.')
      setTarget(null)
      load()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  const bookings = state.status === 'ready' ? state.bookings : []
  const canComplete = (booking) => booking.status === 'confirmed' && new Date(booking.ends_at) <= new Date()

  return (
    <section className="stay-admin stack-sm" aria-labelledby="daycare-admin-title">
      <div className="stay-admin-heading">
        <h2 id="daycare-admin-title">Creche por período</h2>
        {state.status === 'ready' && <span className="calendar-count">{bookings.length} {bookings.length === 1 ? 'reserva' : 'reservas'} na data</span>}
      </div>
      {notice && <Notice>{notice}</Notice>}
      {state.status === 'loading' && <p className="status" role="status">Carregando reservas da creche…</p>}
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      {state.status === 'ready' && bookings.length === 0 && <p className="agenda-empty">Sem reservas da creche nesta data.</p>}
      {bookings.length > 0 && (
        <ul className="stay-admin-list">
          {bookings.map((booking) => {
            const start = formatInstant(booking.starts_at, business.timezone)
            const end = formatInstant(booking.ends_at, business.timezone)
            return (
              <li className="stay-admin-card" key={booking.id} data-status={booking.status}>
                <div className="stay-admin-top">
                  <div>
                    <strong>{booking.pet_name} · {PERIOD_LABELS[booking.period]}</strong>
                    <span>{booking.service_name}{booking.size_label ? ` · ${booking.size_label}` : ''} · {booking.customer_name}</span>
                  </div>
                  <span className={`booking-status ${booking.status === 'completed' ? 'booking-status-completed' : 'booking-status-pending'}`}>
                    {booking.status === 'completed' ? 'Concluída' : 'Confirmada'}
                  </span>
                </div>
                <p className="stay-admin-meta">
                  <span>{start.date} · {start.time}–{end.time}</span>
                  <strong>{formatBRL(booking.price_cents)}</strong>
                  <a href={`tel:${booking.customer_phone}`}>{booking.customer_phone}</a>
                </p>
                {booking.notes && <p className="booking-customer-note"><strong>Observação do cliente</strong><span>{booking.notes}</span></p>}
                {booking.status === 'confirmed' && (
                  <div className="stay-admin-actions">
                    {canComplete(booking) && (
                      <button type="button" className="btn btn-quiet" onClick={() => { setError(''); setTarget({ kind: 'complete', booking }) }}>
                        Concluir período
                      </button>
                    )}
                    <button type="button" className="btn-text" onClick={() => { setError(''); setTarget({ kind: 'cancel', booking }) }}>
                      Cancelar reserva
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(target)}
        title={target?.kind === 'cancel' ? 'Cancelar reserva da creche?' : 'Concluir reserva da creche?'}
        description={target ? `${target.booking.pet_name} · ${PERIOD_LABELS[target.booking.period]}. ${target.kind === 'cancel'
          ? 'A capacidade será liberada e o cancelamento não pode ser desfeito.'
          : 'A reserva permanecerá registrada como concluída.'}` : ''}
        cancelLabel="Não, voltar"
        confirmLabel={target?.kind === 'cancel' ? 'Sim, cancelar' : 'Sim, concluir'}
        busy={busy}
        error={error}
        onCancel={() => { setTarget(null); setError('') }}
        onConfirm={confirm}
      />
    </section>
  )
}

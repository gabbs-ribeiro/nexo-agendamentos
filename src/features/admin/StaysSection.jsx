import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import Notice from '../../components/Notice.jsx'
import PhoneWhatsApp from '../../components/PhoneWhatsApp.jsx'
import { listAdminStaysOnDate, setAdminStayStatus } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { formatBRL, formatInstant, todayInTz } from '../../lib/format.js'
import { formatShortDate, nightsLabel } from '../public-booking/stayDates.js'
import { STAY_PHASE_LABELS, canCompleteStay, stayPhase } from './stayView.js'

// Hospedagens (pet hotel) que entram, saem ou estao hospedadas na data. Independe da agenda de horarios.
export default function StaysSection({ business, date }) {
  const today = todayInTz(business.timezone)
  const [state, setState] = useState({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [target, setTarget] = useState(null) // { kind: 'cancel' | 'complete', stay }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(() => setReload((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    listAdminStaysOnDate(business.id, date)
      .then((stays) => { if (active) setState({ status: 'ready', stays }) })
      .catch((err) => { if (active) setState({ status: 'error', message: messageFor(err) }) })
    return () => { active = false }
  }, [business.id, date, reload])

  async function confirm() {
    if (!target || busy) return
    setBusy(true)
    setError('')
    try {
      await setAdminStayStatus(target.stay.id, target.kind === 'cancel' ? 'cancelled' : 'completed')
      setNotice(target.kind === 'cancel' ? 'Hospedagem cancelada. A vaga foi liberada.' : 'Hospedagem concluída.')
      setTarget(null)
      load()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  const stays = state.status === 'ready' ? state.stays : []
  return (
    <section className="stay-admin stack-sm" aria-labelledby="stay-admin-title">
      <div className="stay-admin-heading">
        <h2 id="stay-admin-title">Hospedagem</h2>
        {state.status === 'ready' && (
          <span className="calendar-count">{stays.length} {stays.length === 1 ? 'reserva' : 'reservas'} na data</span>
        )}
      </div>
      {notice && <Notice>{notice}</Notice>}
      {state.status === 'loading' && <p className="status" role="status">Carregando hospedagens…</p>}
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      {state.status === 'ready' && stays.length === 0 && (
        <p className="agenda-empty">Sem hospedagens nesta data.</p>
      )}
      {stays.length > 0 && (
        <ul className="stay-admin-list">
          {stays.map((stay) => (
            <li className="stay-admin-card" key={stay.id} data-status={stay.status}>
              <div className="stay-admin-top">
                <div>
                  <strong>{stay.pet_name}</strong>
                  <span>{stay.service_name}{stay.size_label ? ` · ${stay.size_label}` : ''} · {stay.customer_name}</span>
                </div>
                <span className={`booking-status ${stay.status === 'completed' ? 'booking-status-completed' : 'booking-status-pending'}`}>
                  {stay.status === 'completed' ? 'Concluída' : STAY_PHASE_LABELS[stayPhase(stay, date)]}
                </span>
              </div>
              <p className="stay-admin-meta">
                <span>{stay.check_in_at
                  ? `${formatInstant(stay.check_in_at, business.timezone).date} ${formatInstant(stay.check_in_at, business.timezone).time} → ${formatInstant(stay.check_out_at, business.timezone).date} ${formatInstant(stay.check_out_at, business.timezone).time}`
                  : `${formatShortDate(stay.check_in)} → ${formatShortDate(stay.check_out)}`}</span>
                <span>{stay.charge_units != null
                  ? `${stay.charge_units} ${stay.charge_units === 1 ? 'diária cobrada' : 'diárias cobradas'}`
                  : nightsLabel(stay.nights)}</span>
                <strong>{formatBRL(stay.total_price_cents)}</strong>
                <PhoneWhatsApp phone={stay.customer_phone} />
              </p>
              {stay.notes && (
                <p className="booking-customer-note">
                  <strong>Observação do cliente</strong>
                  <span>{stay.notes}</span>
                </p>
              )}
              {stay.status === 'confirmed' && (
                <div className="stay-admin-actions">
                  {canCompleteStay(stay, today) && (
                    <button type="button" className="btn btn-quiet"
                      onClick={() => { setError(''); setTarget({ kind: 'complete', stay }) }}>
                      Concluir hospedagem
                    </button>
                  )}
                  <button type="button" className="btn-text"
                    onClick={() => { setError(''); setTarget({ kind: 'cancel', stay }) }}>
                    Cancelar reserva
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(target)}
        title={target?.kind === 'cancel' ? 'Cancelar esta hospedagem?' : 'Concluir esta hospedagem?'}
        description={target
          ? `${target.stay.pet_name} · ${formatShortDate(target.stay.check_in)} → ${formatShortDate(target.stay.check_out)} (${target.stay.charge_units ?? target.stay.nights} diárias). ${target.kind === 'cancel'
            ? 'A vaga será liberada e o cancelamento não pode ser desfeito.'
            : 'A hospedagem permanecerá registrada como concluída.'}`
          : ''}
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

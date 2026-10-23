import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Notice from '../../components/Notice.jsx'
import { createPublicTimedStay, getTimedStayOptions } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import {
  addDaysYmd, formatBRL, formatLongDate, newIdempotencyKey, todayInTz, whatsappUrl,
} from '../../lib/format.js'
import { initialForm } from './bookingReducer.js'
import { saveStayConfirmation } from './StayConfirmedPage.jsx'
import StepDetails from './StepDetails.jsx'
import { findSelectedService } from './serviceSelection.js'
import { useFocusOnMount } from './useFocusOnMount.js'
import { usePublic } from './usePublic.js'

const optionKey = (option) => `${option.check_out}|${option.check_out_time}`

function durationLabel(hours) {
  const wholeDays = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return [wholeDays ? `${wholeDays} ${wholeDays === 1 ? 'diária' : 'diárias'}` : '',
    remainingHours ? `${remainingHours} h` : ''].filter(Boolean).join(' e ')
}

export default function TimedStayPage() {
  const { slug, business, services } = usePublic()
  const location = useLocation()
  const navigate = useNavigate()
  const h1 = useFocusOnMount()
  const optionId = location.state?.optionId ?? null
  const selected = useMemo(
    () => findSelectedService(services.filter((service) => service.booking_mode === 'stay'), optionId),
    [services, optionId],
  )
  const today = todayInTz(business.timezone)
  const checkInTimes = selected?.service.booking_settings?.check_in_times ?? []
  const [checkIn, setCheckIn] = useState('')
  const [entryTime, setEntryTime] = useState('')
  const [optionsState, setOptionsState] = useState({ status: 'idle' })
  const [selectedExit, setSelectedExit] = useState('')
  const [step, setStep] = useState('dates')
  const [form, setForm] = useState(initialForm)
  const [key, setKey] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState(null)
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const wa = whatsappUrl(business.contact_phone)

  useEffect(() => {
    if (!selected || !checkIn || !entryTime) {
      setOptionsState({ status: 'idle' })
      return undefined
    }
    let active = true
    setOptionsState({ status: 'loading' })
    getTimedStayOptions(slug, selected.option.option_id, checkIn, entryTime)
      .then((data) => { if (active) setOptionsState({ status: 'ready', data }) })
      .catch((error) => {
        if (active) setOptionsState({ status: 'error', message: messageFor(error) })
      })
    return () => { active = false }
  }, [slug, selected, checkIn, entryTime, refresh])

  if (!selected) return <Navigate to={`/${slug}`} replace />
  if (!selected.service.booking_settings) {
    return <div className="stack">
      <Notice tone="error">Os horários de entrada e saída ainda não foram configurados. Fale com o estabelecimento.</Notice>
      <Link className="btn btn-quiet" to={`/${slug}`}>Voltar aos serviços</Link>
    </div>
  }
  if (checkInTimes.length === 0) {
    return <div className="stack">
      <Notice tone="error">O estabelecimento ainda não configurou horários de entrada.</Notice>
      <Link className="btn btn-quiet" to={`/${slug}`}>Voltar aos serviços</Link>
    </div>
  }

  const options = optionsState.status === 'ready' ? optionsState.data.options : []
  const currentExit = options.find((option) => optionKey(option) === selectedExit)
  const canContinue = currentExit?.available === true
  const maxCheckIn = addDaysYmd(today, business.max_days_ahead)

  function changeEntryDate(date) {
    setCheckIn(date)
    setSelectedExit('')
    setNotice('')
    setKey(null)
  }

  async function submit() {
    if (!currentExit || !key || submitting) return
    setSubmitting(true)
    setFailure(null)
    try {
      const stay = await createPublicTimedStay({
        slug,
        optionId: selected.option.option_id,
        checkIn,
        entryTime,
        checkOut: currentExit.check_out,
        exitTime: currentExit.check_out_time,
        idempotencyKey: key,
        form: {
          name: form.name.trim(), phone: form.phone, petName: form.petName.trim(),
          petBreed: form.petBreed.trim(), notes: form.notes.trim(), consent: form.consent,
        },
      })
      saveStayConfirmation(slug, stay)
      navigate(`/${slug}/hospedagem/confirmado`, { replace: true, state: { stay } })
    } catch (error) {
      if (error.code === 'STAY_FULL') {
        setStep('dates')
        setKey(null)
        setNotice(messageFor(error))
        setRefresh((value) => value + 1)
      } else {
        setFailure({ code: error.code, message: messageFor(error) })
      }
      setSubmitting(false)
    }
  }

  return (
    <div className="stack">
      <div className="stepper">
        {step === 'dates'
          ? <Link className="btn-text" to={`/${slug}`}>Voltar</Link>
          : <button type="button" className="btn-text" onClick={() => setStep('dates')}>Voltar</button>}
        <span className="small muted">Passo {step === 'dates' ? 1 : 2} de 2</span>
      </div>

      <div className="summary">
        <p className="summary-title"><strong>{selected.service.name}</strong><span className="summary-size">porte {selected.option.size_label.toLowerCase()}</span></p>
        <p className="summary-meta"><span>por diária</span><span className="summary-price">{formatBRL(selected.option.price_cents)}</span></p>
        {currentExit && step === 'details' && (
          <p className="summary-when">{formatLongDate(checkIn)} {entryTime} → {formatLongDate(currentExit.check_out)} {currentExit.check_out_time}</p>
        )}
      </div>

      {step === 'dates' && (
        <div className="stack">
          <div className="stack-sm">
            <h1 ref={h1} tabIndex={-1}>Escolha a entrada e a saída</h1>
            <p className="muted">As saídas disponíveis seguem a configuração do estabelecimento e os intervalos de 12 horas.</p>
          </div>
          <div className="stay-dates">
            <div className="field">
              <label htmlFor="timed-stay-check-in">Data de entrada</label>
              <input id="timed-stay-check-in" type="date" min={today} max={maxCheckIn} value={checkIn}
                onChange={(event) => changeEntryDate(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="timed-stay-entry-time">Horário de entrada</label>
              <select id="timed-stay-entry-time" required value={entryTime}
                onChange={(event) => { setEntryTime(event.target.value); setSelectedExit(''); setKey(null) }}>
                <option value="">Selecione</option>
                {checkInTimes.map((time) => (
                  <option key={time} value={time.slice(0, 5)}>{time.slice(0, 5)}</option>
                ))}
              </select>
            </div>
          </div>
          {notice && <Notice tone="error">{notice}</Notice>}
          {optionsState.status === 'loading' && <p className="status" role="status">Consultando saídas e vagas…</p>}
          {optionsState.status === 'error' && <Notice tone="error">{optionsState.message}</Notice>}
          {optionsState.status === 'ready' && options.length === 0 && (
            <Notice tone="error">
              Não há horários de saída compatíveis com essa entrada e com os intervalos de duração permitidos.
              Ajuste a entrada ou fale com o estabelecimento{wa ? <> pelo <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></> : ''}.
            </Notice>
          )}
          {options.length > 0 && (
            <fieldset className="timed-stay-options">
              <legend>Opções de saída</legend>
              {options.map((option) => {
                const keyForOption = optionKey(option)
                const unavailable = !option.available
                return (
                  <label className="booking-mode-option" key={keyForOption} data-checked={selectedExit === keyForOption}>
                    <input type="radio" name="stay-exit-option" value={keyForOption}
                      checked={selectedExit === keyForOption}
                      disabled={unavailable}
                      onChange={() => setSelectedExit(keyForOption)} />
                    <span className="booking-mode-copy">
                      <strong>{formatLongDate(option.check_out)} às {option.check_out_time}{unavailable ? ' · sem vaga' : ''}</strong>
                      <small>{durationLabel(option.duration_hours)} · {option.charge_units} {option.charge_units === 1 ? 'diária cobrada' : 'diárias cobradas'}</small>
                    </span>
                    <strong>{formatBRL(option.total_price_cents)}</strong>
                  </label>
                )
              })}
            </fieldset>
          )}
          {currentExit && (
            <section className="stay-total" aria-live="polite">
              <p className="muted">{formatLongDate(checkIn)} {entryTime} até {formatLongDate(currentExit.check_out)} {currentExit.check_out_time}</p>
              <p><span>{currentExit.charge_units} × {formatBRL(currentExit.daily_price_cents)}</span><strong>{formatBRL(currentExit.total_price_cents)}</strong></p>
            </section>
          )}
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={!canContinue}
              onClick={() => { setKey(newIdempotencyKey()); setStep('details') }}>
              Continuar
            </button>
          </div>
        </div>
      )}
      {step === 'details' && (
        <StepDetails
          slug={slug}
          title="Dados da hospedagem"
          submitLabel="Confirmar reserva"
          form={form}
          onField={(name, value) => setForm((current) => ({ ...current, [name]: value }))}
          onSubmit={submit}
          submitting={submitting}
          failure={failure}
        />
      )}
    </div>
  )
}

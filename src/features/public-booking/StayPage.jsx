import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Notice from '../../components/Notice.jsx'
import { createPublicStay, getStayQuote } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import {
  addDaysYmd, formatBRL, formatLongDate, newIdempotencyKey, todayInTz, whatsappUrl,
} from '../../lib/format.js'
import { initialForm } from './bookingReducer.js'
import { saveStayConfirmation } from './StayConfirmedPage.jsx'
import StepDetails from './StepDetails.jsx'
import { findSelectedService } from './serviceSelection.js'
import {
  MAX_STAY_NIGHTS, STAY_DATE_MESSAGES, nightsLabel, validateStayDates,
} from './stayDates.js'
import { useFocusOnMount } from './useFocusOnMount.js'
import { usePublic } from './usePublic.js'

export default function StayPage() {
  const { slug, business, services } = usePublic()
  const location = useLocation()
  const navigate = useNavigate()
  const h1 = useFocusOnMount()
  const optionId = location.state?.optionId ?? null
  const selected = useMemo(
    () => findSelectedService(services.filter((service) => service.booking_mode === 'daily'), optionId),
    [services, optionId],
  )
  const today = todayInTz(business.timezone)
  const wa = whatsappUrl(business.contact_phone)

  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [quote, setQuote] = useState({ status: 'idle' })
  const [refresh, setRefresh] = useState(0)
  const [step, setStep] = useState('dates')
  const [form, setForm] = useState(initialForm)
  const [key, setKey] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState(null)
  const [notice, setNotice] = useState('')

  const dateError = validateStayDates({
    checkIn, checkOut, today, maxDaysAhead: business.max_days_ahead, addDays: addDaysYmd,
  })

  // Consulta o banco (vagas, diarias e valor) sempre que as datas mudam.
  useEffect(() => {
    if (!selected || dateError) {
      setQuote({ status: 'idle' })
      return undefined
    }
    let active = true
    setQuote({ status: 'loading' })
    getStayQuote(slug, selected.option.option_id, checkIn, checkOut)
      .then((data) => { if (active) setQuote({ status: 'ready', data }) })
      .catch((err) => { if (active) setQuote({ status: 'error', message: messageFor(err) }) })
    return () => { active = false }
  }, [slug, selected, checkIn, checkOut, dateError, refresh])

  if (!selected) return <Navigate to={`/${slug}`} replace />

  const maxCheckIn = addDaysYmd(today, business.max_days_ahead)
  const minCheckOut = addDaysYmd(checkIn || today, 1)
  const maxCheckOut = checkIn ? addDaysYmd(checkIn, MAX_STAY_NIGHTS) : undefined

  function changeDates(nextIn, nextOut) {
    setCheckIn(nextIn)
    setCheckOut(nextOut)
    setStep('dates')
    setKey(null)
    setNotice('')
  }

  async function submit() {
    setSubmitting(true)
    setFailure(null)
    try {
      const stay = await createPublicStay({
        slug,
        optionId: selected.option.option_id,
        checkIn,
        checkOut,
        idempotencyKey: key, // mesma chave em retries: o banco nao duplica
        form: {
          name: form.name.trim(), phone: form.phone, petName: form.petName.trim(),
          petBreed: form.petBreed.trim(), notes: form.notes.trim(), consent: form.consent,
        },
      })
      saveStayConfirmation(slug, stay)
      navigate(`/${slug}/hospedagem/confirmado`, { replace: true, state: { stay } })
    } catch (err) {
      if (err.code === 'STAY_FULL') {
        setStep('dates')
        setKey(null)
        setNotice(messageFor(err))
        setRefresh((value) => value + 1)
      } else {
        setFailure({ code: err.code, message: messageFor(err) })
      }
      setSubmitting(false)
    }
  }

  const ready = quote.status === 'ready' ? quote.data : null
  const soldOut = ready && ready.available === false
  const canContinue = ready && ready.available === true

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
        {canContinue && step === 'details' && (
          <p className="summary-when">{formatLongDate(checkIn)} → {formatLongDate(checkOut)} · {nightsLabel(ready.nights)}</p>
        )}
      </div>

      {step === 'dates' && (
        <div className="stack">
          <div className="stack-sm">
            <h1 ref={h1} tabIndex={-1}>Escolha as datas da hospedagem</h1>
            <p className="muted">A noite da saída não conta como diária.</p>
          </div>

          <div className="stay-dates">
            <div className="field">
              <label htmlFor="stay-check-in">Entrada</label>
              <input id="stay-check-in" type="date" min={today} max={maxCheckIn} value={checkIn}
                onChange={(event) => {
                  const value = event.target.value
                  changeDates(value, checkOut && value && checkOut <= value ? '' : checkOut)
                }} />
            </div>
            <div className="field">
              <label htmlFor="stay-check-out">Saída</label>
              <input id="stay-check-out" type="date" min={minCheckOut} max={maxCheckOut} value={checkOut}
                onChange={(event) => changeDates(checkIn, event.target.value)} />
            </div>
          </div>

          {notice && <Notice tone="error">{notice}</Notice>}
          {checkIn && checkOut && dateError && dateError !== 'MISSING' && (
            <Notice tone="error">{STAY_DATE_MESSAGES[dateError]}</Notice>
          )}
          {quote.status === 'loading' && <p className="status" role="status">Consultando vagas…</p>}
          {quote.status === 'error' && <Notice tone="error">{quote.message}</Notice>}

          {soldOut && (
            <Notice tone="error">
              Esgotado nas datas escolhidas. Escolha outras datas
              {wa
                ? <> ou <a href={wa} target="_blank" rel="noopener noreferrer">fale com o estabelecimento pelo WhatsApp</a></>
                : ' ou entre em contato com o estabelecimento'}.
            </Notice>
          )}

          {canContinue && (
            <section className="stay-total" aria-live="polite">
              <p className="muted">
                {formatLongDate(checkIn)} até {formatLongDate(checkOut)}
              </p>
              <p>
                <span>{nightsLabel(ready.nights)} × {formatBRL(ready.daily_price_cents)}</span>
                <strong>{formatBRL(ready.total_price_cents)}</strong>
              </p>
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

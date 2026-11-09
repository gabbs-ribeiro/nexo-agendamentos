import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Notice from '../../components/Notice.jsx'
import { createPublicPeriodBooking, getPeriodQuote } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import {
  bookableDays, dayChipParts, formatBRL, formatLongDate, newIdempotencyKey,
} from '../../lib/format.js'
import { initialForm } from './bookingReducer.js'
import StepDetails from './StepDetails.jsx'
import { findSelectedService } from './serviceSelection.js'
import { useFocusOnMount } from './useFocusOnMount.js'
import { usePublic } from './usePublic.js'

const periodTypes = [
  ['morning', 'Manhã'],
  ['afternoon', 'Tarde'],
  ['full_day', 'Integral'],
]
const storeKey = (slug) => `nexo:last-period:${slug}`

export function savePeriodConfirmation(slug, booking) {
  try { sessionStorage.setItem(storeKey(slug), JSON.stringify(booking)) } catch { /* location state still works */ }
}

export default function PeriodPage() {
  const { slug, business, services } = usePublic()
  const location = useLocation()
  const navigate = useNavigate()
  const h1 = useFocusOnMount()
  const optionId = location.state?.optionId ?? null
  const selected = useMemo(
    () => findSelectedService(services.filter((service) => service.booking_mode === 'periods'), optionId),
    [services, optionId],
  )
  const days = useMemo(
    () => bookableDays(business.timezone, business.max_days_ahead),
    [business.timezone, business.max_days_ahead],
  )
  const [date, setDate] = useState('')
  const [period, setPeriod] = useState('morning')
  const [quote, setQuote] = useState({ status: 'idle' })
  const [refresh, setRefresh] = useState(0)
  const [step, setStep] = useState('period')
  const [form, setForm] = useState(initialForm)
  const [key, setKey] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!selected || !date) {
      setQuote({ status: 'idle' })
      return undefined
    }
    let active = true
    setQuote({ status: 'loading' })
    getPeriodQuote(slug, selected.option.option_id, date, period)
      .then((data) => { if (active) setQuote({ status: 'ready', data }) })
      .catch((error) => {
        if (active) setQuote({ status: 'error', message: messageFor(error) })
      })
    return () => { active = false }
  }, [slug, selected, date, period, refresh])

  if (!selected) return <Navigate to={`/${slug}`} replace />
  const settings = selected.service.booking_settings
  if (!settings) {
    return <div className="stack">
      <Notice tone="error">Os horários dos períodos ainda não foram configurados. Fale com o estabelecimento.</Notice>
      <Link className="btn btn-quiet" to={`/${slug}`}>Voltar aos serviços</Link>
    </div>
  }

  const ready = quote.status === 'ready' ? quote.data : null
  const soldOut = ready?.available === false
  const starts = period === 'afternoon' ? settings.afternoon_start : settings.morning_start
  const ends = period === 'morning' ? settings.morning_end : settings.afternoon_end
  const localTime = (time) => time?.slice(0, 5) ?? ''

  async function submit() {
    if (!ready?.available || !key || submitting) return
    setSubmitting(true)
    setFailure(null)
    try {
      const booking = await createPublicPeriodBooking({
        slug,
        optionId: selected.option.option_id,
        date,
        period,
        idempotencyKey: key,
        form: {
          name: form.name.trim(), phone: form.phone, petName: form.petName.trim(),
          petBreed: form.petBreed.trim(), notes: form.notes.trim(), consent: form.consent,
        },
      })
      savePeriodConfirmation(slug, booking)
      navigate(`/${slug}/periodos/confirmado`, { replace: true, state: { booking } })
    } catch (error) {
      if (error.code === 'DAYCARE_FULL') {
        setStep('period')
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
        {step === 'period'
          ? <Link className="btn-text" to={`/${slug}`}>Voltar</Link>
          : <button type="button" className="btn-text" onClick={() => setStep('period')}>Voltar</button>}
        <span className="small muted">Passo {step === 'period' ? 1 : 2} de 2</span>
      </div>
      <div className="summary">
        <p className="summary-title"><strong>{selected.service.name}</strong><span className="summary-size">porte {selected.option.size_label.toLowerCase()}</span></p>
        {ready && step === 'details' && (
          <p className="summary-when">{formatLongDate(date)} · {ready.local_start}–{ready.local_end}</p>
        )}
      </div>

      {step === 'period' && (
        <div className="stack">
          <div className="stack-sm">
            <h1 ref={h1} tabIndex={-1}>Escolha o dia e o período</h1>
            <p className="muted">A creche tem capacidade compartilhada de até quatro pets em cada período.</p>
          </div>
          <section className="when-card" aria-labelledby="daycare-day-title">
            <div className="when-card-head">
              <h2 id="daycare-day-title">Escolha o dia</h2>
              {date && <span className="when-date">{formatLongDate(date)}</span>}
            </div>
            <div className="days booking-days" role="group" aria-labelledby="daycare-day-title">
              {days.map((day) => {
                const parts = dayChipParts(day)
                return (
                  <button key={day} type="button" className="chip" aria-pressed={day === date}
                    aria-label={formatLongDate(day)}
                    onClick={() => { setDate(day); setNotice(''); setKey(null) }}>
                    <span>{parts.weekday}</span>
                    <span className="day">{parts.day}</span>
                    <span>{parts.month}</span>
                  </button>
                )
              })}
            </div>
          </section>
          <fieldset className="booking-mode-picker">
            <legend>Período</legend>
            <div className="booking-mode-options">
              {periodTypes.map(([value, title]) => {
                const periodStart = value === 'afternoon' ? settings.afternoon_start : settings.morning_start
                const periodEnd = value === 'morning' ? settings.morning_end : settings.afternoon_end
                return (
                  <label className="booking-mode-option" key={value} data-checked={period === value}>
                    <input type="radio" name="daycare-period" value={value}
                      checked={period === value}
                      onChange={() => { setPeriod(value); setKey(null) }} />
                    <span className="booking-mode-copy">
                      <strong>{title}</strong>
                      <small>{localTime(periodStart)}–{localTime(periodEnd)}</small>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          {notice && <Notice tone="error">{notice}</Notice>}
          {quote.status === 'loading' && <p className="status" role="status">Consultando vagas e preço…</p>}
          {quote.status === 'error' && <Notice tone="error">{quote.message}</Notice>}
          {soldOut && <Notice tone="error">Este período não está disponível para agendamento. Escolha outro período ou dia.</Notice>}
          {ready?.available && (
            <section className="stay-total" aria-live="polite">
              <p className="muted">{formatLongDate(date)} · {ready.local_start}–{ready.local_end}</p>
              <p><span>{periodTypes.find(([value]) => value === period)?.[1]}</span><strong>{formatBRL(ready.price_cents)}</strong></p>
            </section>
          )}
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={!ready?.available}
              onClick={() => { setKey(newIdempotencyKey()); setStep('details') }}>
              Continuar
            </button>
          </div>
        </div>
      )}
      {step === 'details' && (
        <StepDetails
          slug={slug}
          title="Dados da creche"
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

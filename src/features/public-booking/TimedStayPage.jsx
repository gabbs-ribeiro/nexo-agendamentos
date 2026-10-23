import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Notice from '../../components/Notice.jsx'
import { createPublicTimedStay, getTimedStayOptions } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import {
  addDaysYmd, bookableDays, dayChipParts, formatBRL, formatLongDate, newIdempotencyKey, todayInTz, whatsappUrl,
} from '../../lib/format.js'
import { initialForm } from './bookingReducer.js'
import { saveStayConfirmation } from './StayConfirmedPage.jsx'
import { minutesNowInTz, timeOptionsInRange, timeToMinutes } from '../../lib/timeRanges.js'
import {
  chargeUnitsLabel, exitCandidatesForDate, exitDatesFor, exitStatus, hasNoFurtherStayOptionThatDay,
} from './stayOptions.js'
import StepDetails from './StepDetails.jsx'
import { findSelectedService } from './serviceSelection.js'
import { useFocusOnMount } from './useFocusOnMount.js'
import { usePublic } from './usePublic.js'

const short = (time) => String(time).slice(0, 5)

function durationLabel(hours) {
  const wholeDays = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return [wholeDays ? `${wholeDays} ${wholeDays === 1 ? 'diária' : 'diárias'}` : '',
    remainingHours ? `${remainingHours} h` : ''].filter(Boolean).join(' e ')
}

const RELATION_LABELS = {
  same: 'Mesmo horário da entrada',
  after: '12 horas depois do horário de entrada',
  before: '12 horas antes do horário de entrada',
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
  const settings = selected?.service.booking_settings
  const checkInTimes = timeOptionsInRange(settings?.check_in_start, settings?.check_in_end)
  const checkOutTimes = timeOptionsInRange(settings?.check_out_start, settings?.check_out_end)
  const exitWindow = settings ? { start: short(settings.check_out_start), end: short(settings.check_out_end) } : null
  const entryDays = useMemo(
    () => bookableDays(business.timezone, business.max_days_ahead),
    [business.timezone, business.max_days_ahead],
  )
  const [checkIn, setCheckIn] = useState('')
  const [entryTime, setEntryTime] = useState('')
  const [checkOutDate, setCheckOutDate] = useState('')
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
  const exitDays = useMemo(() => exitDatesFor({ checkIn, entryTime }), [checkIn, entryTime])

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
  if (checkInTimes.length === 0 || checkOutTimes.length === 0) {
    return <div className="stack">
      <Notice tone="error">O estabelecimento ainda não configurou horários de entrada.</Notice>
      <Link className="btn btn-quiet" to={`/${slug}`}>Voltar aos serviços</Link>
    </div>
  }

  const nowMinutes = minutesNowInTz(business.timezone)
  const entryPassed = (time) => checkIn === today && timeToMinutes(time) <= nowMinutes
  const allEntryPassed = checkIn === today && checkInTimes.every(entryPassed)
  const candidates = optionsState.status === 'ready' && checkOutDate
    ? exitCandidatesForDate({ checkIn, entryTime, exitDate: checkOutDate, options: optionsState.data.options })
    : []
  const statusOf = (candidate) => exitStatus(candidate, exitWindow)
  const currentCandidate = candidates.find((candidate) => candidate.key === selectedExit)
  const currentExit = currentCandidate && statusOf(currentCandidate) === 'available' ? currentCandidate.option : null
  const noFurtherOptionToday = optionsState.status === 'ready'
    && hasNoFurtherStayOptionThatDay(optionsState.data.options, currentExit)
  const anyAvailable = candidates.some((candidate) => statusOf(candidate) === 'available')
  const anyFull = candidates.some((candidate) => statusOf(candidate) === 'full')
  const canContinue = Boolean(currentExit)
  const entryDone = Boolean(checkIn && entryTime)

  function resetExit() {
    setSelectedExit('')
    setKey(null)
    setNotice('')
  }

  function changeEntryDate(date) {
    setCheckIn(date)
    if (entryTime && date === today && timeToMinutes(entryTime) <= nowMinutes) setEntryTime('')
    setCheckOutDate('')
    resetExit()
  }

  function changeEntryTime(time) {
    setEntryTime(time)
    if (checkOutDate && !exitDatesFor({ checkIn, entryTime: time }).includes(checkOutDate)) setCheckOutDate('')
    resetExit()
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
        <div className="stack stay-flow">
          <header className="step-head">
            <h1 ref={h1} tabIndex={-1}>Escolha a entrada e a saída</h1>
            <p className="muted">Primeiro o dia e o horário em que seu pet chega. Depois, quando você vai buscá-lo.</p>
          </header>
          {notice && <Notice tone="error">{notice}</Notice>}

          <section className="when-card stay-step" data-done={entryDone} aria-labelledby="stay-entry-title">
            <div className="stay-step-head">
              <span className="stay-step-badge" aria-hidden="true">{entryDone ? '✓' : '1'}</span>
              <div>
                <h2 id="stay-entry-title">Entrada</h2>
                <p>Quando o pet chega ao hotel.</p>
              </div>
            </div>
            <p className="stay-label" id="stay-entry-day-label">Dia da entrada</p>
            <div className="days booking-days" role="group" aria-labelledby="stay-entry-day-label">
              {entryDays.map((day) => {
                const parts = dayChipParts(day)
                return (
                  <button key={day} type="button" className="chip" aria-pressed={day === checkIn}
                    aria-label={formatLongDate(day)} onClick={() => changeEntryDate(day)}>
                    <span>{parts.weekday}</span>
                    <span className="day">{parts.day}</span>
                    <span>{parts.month}</span>
                  </button>
                )
              })}
            </div>

            {checkIn && (
              <div aria-live="polite">
                <p className="stay-label" id="stay-entry-time-label">Horário da entrada</p>
                <p className="stay-caption">
                  Entrada das {short(settings.check_in_start)} às {short(settings.check_in_end)}, a cada 30 minutos.
                </p>
                {allEntryPassed ? (
                  <div className="slots-empty">
                    <span className="paw" aria-hidden="true">🐾</span>
                    <p>Hoje não há mais horários de entrada.</p>
                    <p className="muted small">Escolha outro dia acima.</p>
                  </div>
                ) : (
                  <div className="slots" role="group" aria-labelledby="stay-entry-time-label">
                    {checkInTimes.map((time) => {
                      const passed = entryPassed(time)
                      return (
                        <button key={time} type="button" className="slot" disabled={passed}
                          title={passed ? 'Esse horário já passou' : undefined}
                          aria-pressed={time === entryTime} onClick={() => changeEntryTime(time)}>
                          {time}
                        </button>
                      )
                    })}
                  </div>
                )}
                {checkIn === today && !allEntryPassed && checkInTimes.some(entryPassed) && (
                  <p className="stay-caption">Horários que já passaram hoje ficam indisponíveis.</p>
                )}
              </div>
            )}
          </section>

          {entryDone && (
            <section className="when-card stay-step" data-done={Boolean(currentExit)} aria-labelledby="stay-exit-title">
              <div className="stay-step-head">
                <span className="stay-step-badge" aria-hidden="true">{currentExit ? '✓' : '2'}</span>
                <div>
                  <h2 id="stay-exit-title">Saída</h2>
                  <p>Quando você vai buscar o pet.</p>
                </div>
              </div>
              <p className="stay-label" id="stay-exit-day-label">Dia da saída</p>
              <div className="days booking-days" role="group" aria-labelledby="stay-exit-day-label">
                {exitDays.map((day) => {
                  const parts = dayChipParts(day)
                  return (
                    <button key={day} type="button" className="chip" aria-pressed={day === checkOutDate}
                      aria-label={formatLongDate(day)}
                      onClick={() => { setCheckOutDate(day); resetExit() }}>
                      <span>{parts.weekday}</span>
                      <span className="day">{parts.day}</span>
                      <span>{parts.month}</span>
                    </button>
                  )
                })}
              </div>

              {optionsState.status === 'loading' && <p className="status" role="status">Consultando saídas e vagas…</p>}
              {optionsState.status === 'error' && <Notice tone="error">{optionsState.message}</Notice>}

              {checkOutDate && optionsState.status === 'ready' && (
                <div aria-live="polite">
                  <p className="stay-label" id="stay-exit-time-label">Horário da saída</p>
                  <p className="stay-caption">
                    A saída acontece no mesmo horário da entrada ou 12 horas antes/depois dele.
                    Retirada permitida das {exitWindow.start} às {exitWindow.end}.
                  </p>
                  {candidates.length === 0 ? (
                    <div className="slots-empty">
                      <span className="paw" aria-hidden="true">🐾</span>
                      <p>Não há saída possível nesta data.</p>
                      <p className="muted small">Escolha outro dia de saída.</p>
                    </div>
                  ) : (
                    <div className="stay-exit-list" role="group" aria-labelledby="stay-exit-time-label">
                      {candidates.map((candidate) => {
                        const status = statusOf(candidate)
                        const option = candidate.option
                        const body = (
                          <>
                            <span className="stay-exit-top">
                              <span className="stay-exit-time">{candidate.time}</span>
                              {option && status === 'available' && (
                                <span className="stay-exit-price">{formatBRL(option.total_price_cents)}</span>
                              )}
                            </span>
                            <span className="stay-exit-tag">{RELATION_LABELS[candidate.relation]}</span>
                            <span className="stay-exit-meta">
                              {durationLabel(candidate.hours)} de permanência · {chargeUnitsLabel(candidate.units)} cobrada{candidate.units <= 1 ? '' : 's'}
                            </span>
                            {status === 'outside' && (
                              <span className="stay-exit-warn">
                                <span aria-hidden="true">⚠ </span>
                                Fora do horário: ultrapassa o horário de retirada do pet ({exitWindow.start} às {exitWindow.end}).
                              </span>
                            )}
                            {status === 'full' && (
                              <span className="stay-exit-warn"><span aria-hidden="true">⛔ </span>Esgotado neste horário.</span>
                            )}
                            {status === 'unavailable' && (
                              <span className="stay-exit-warn"><span aria-hidden="true">⛔ </span>Indisponível para esta reserva.</span>
                            )}
                          </>
                        )
                        return status === 'available' ? (
                          <button key={candidate.key} type="button" className="stay-exit-card" data-state="available"
                            aria-pressed={selectedExit === candidate.key} onClick={() => setSelectedExit(candidate.key)}>
                            {body}
                          </button>
                        ) : (
                          <div key={candidate.key} className="stay-exit-card" data-state={status}>
                            {body}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {candidates.length > 0 && !anyAvailable && (
                    <Notice tone="error">
                      Nenhum horário disponível nesta data. Escolha outra data de saída ou outro horário de entrada
                      {anyFull && wa
                        ? <>, ou <a href={wa} target="_blank" rel="noopener noreferrer">fale com o estabelecimento pelo WhatsApp</a></>
                        : ''}.
                    </Notice>
                  )}
                  {noFurtherOptionToday && (
                    <p className="hint" role="status">
                      Não há mais opções de saída neste dia. Para estender a hospedagem por mais 12 horas, ajuste o horário de entrada ou acrescente mais uma diária escolhendo a próxima data de saída.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {currentExit && (
            <section className="stay-summary" aria-live="polite" aria-labelledby="stay-summary-title">
              <h2 id="stay-summary-title" className="sr-only">Resumo da hospedagem</h2>
              <div className="stay-summary-grid">
                <div className="stay-summary-side">
                  <span className="stay-summary-kicker">Entrada</span>
                  <span className="stay-summary-date">{formatLongDate(checkIn)}</span>
                  <strong className="stay-summary-time">{entryTime}</strong>
                </div>
                <div className="stay-summary-mid" aria-hidden="true">
                  <span className="stay-summary-arrow">→</span>
                  <span>{chargeUnitsLabel(currentExit.charge_units)}</span>
                </div>
                <div className="stay-summary-side">
                  <span className="stay-summary-kicker">Saída</span>
                  <span className="stay-summary-date">{formatLongDate(currentExit.check_out)}</span>
                  <strong className="stay-summary-time">{currentExit.check_out_time}</strong>
                </div>
              </div>
              <div className="stay-summary-total">
                <span>{chargeUnitsLabel(currentExit.charge_units)} × {formatBRL(currentExit.daily_price_cents)}</span>
                <strong>{formatBRL(currentExit.total_price_cents)}</strong>
              </div>
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

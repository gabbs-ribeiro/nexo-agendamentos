import { useMemo, useReducer, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createPublicBooking } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import Notice from '../../components/Notice.jsx'
import { saveConfirmation } from './ConfirmedPage.jsx'
import { STEPS, initialState, reducer } from './bookingReducer.js'
import StepService from './StepService.jsx'
import StepDateTime from './StepDateTime.jsx'
import StepDetails from './StepDetails.jsx'
import SummaryBar from './SummaryBar.jsx'
import { usePublic } from './usePublic.js'

export default function BookingPage() {
  const { slug, business, services } = usePublic()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(reducer, initialState)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState(null)

  const selected = useMemo(() => {
    for (const service of services) {
      const option = service.options.find((o) => o.option_id === state.optionId)
      if (option) return { service, option }
    }
    return null
  }, [services, state.optionId])

  if (services.length === 0) {
    return (
      <div className="stack">
        <Notice>Este estabelecimento ainda não publicou os serviços. Tente novamente mais tarde.</Notice>
        <Link className="btn btn-quiet" to={`/${slug}`}>Voltar</Link>
      </div>
    )
  }

  const index = STEPS.indexOf(state.step)
  const goTo = (step) => dispatch({ type: 'step', step })

  async function submit() {
    setSubmitting(true)
    setFailure(null)
    const f = state.form
    try {
      const booking = await createPublicBooking({
        slug,
        optionId: state.optionId,
        startsAt: state.slot.starts_at,
        idempotencyKey: state.key, // mesma chave em retries: o banco nao duplica
        form: {
          name: f.name.trim(), phone: f.phone, petName: f.petName.trim(),
          petBreed: f.petBreed.trim(), notes: f.notes.trim(), consent: f.consent,
        },
      })
      saveConfirmation(slug, booking)
      navigate(`/${slug}/confirmado`, { replace: true, state: { booking } })
    } catch (err) {
      if (err.code === 'SLOT_UNAVAILABLE') dispatch({ type: 'slot_taken', notice: messageFor(err) })
      else setFailure({ code: err.code, message: messageFor(err) })
      setSubmitting(false)
    }
  }

  return (
    <div className="stack">
      <div>
        <div className="stepper">
          {index === 0
            ? <Link className="btn-text" to={`/${slug}`}>Voltar</Link>
            : <button type="button" className="btn-text" onClick={() => goTo(STEPS[index - 1])}>Voltar</button>}
          <span className="small muted">Passo {index + 1} de {STEPS.length}</span>
        </div>
        <div className="progress" aria-hidden="true">
          {STEPS.map((s, i) => <span key={s} data-done={i <= index} />)}
        </div>
      </div>

      {selected && index > 0 && <SummaryBar selected={selected} slot={state.slot} timezone={business.timezone} />}

      {state.step === 'service' && (
        <StepService
          services={services}
          optionId={state.optionId}
          onSelect={(optionId) => dispatch({ type: 'option', optionId })}
          onNext={() => goTo('datetime')}
        />
      )}
      {state.step === 'datetime' && (
        <StepDateTime
          slug={slug}
          business={business}
          optionId={state.optionId}
          date={state.date}
          slot={state.slot}
          notice={state.notice}
          onDate={(date) => dispatch({ type: 'date', date })}
          onSlot={(slot) => dispatch({ type: 'slot', slot })}
          onNext={() => goTo('details')}
        />
      )}
      {state.step === 'details' && (
        <StepDetails
          slug={slug}
          form={state.form}
          onField={(name, value) => dispatch({ type: 'field', name, value })}
          onSubmit={submit}
          submitting={submitting}
          failure={failure}
        />
      )}
    </div>
  )
}

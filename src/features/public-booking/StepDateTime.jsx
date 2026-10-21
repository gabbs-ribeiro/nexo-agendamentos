import { useEffect, useMemo, useState } from 'react'
import { getAvailableSlots } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { bookableDays, dayChipParts, formatLongDate } from '../../lib/format.js'
import Notice from '../../components/Notice.jsx'
import { useFocusOnMount } from './useFocusOnMount.js'

export default function StepDateTime({ slug, business, optionId, date, slot, notice, onDate, onSlot, onNext }) {
  const h1 = useFocusOnMount()
  const [slots, setSlots] = useState({ status: 'idle', rows: [], message: null })
  const [tick, setTick] = useState(0)

  const days = useMemo(
    () => bookableDays(business.timezone, business.max_days_ahead),
    [business.timezone, business.max_days_ahead],
  )

  useEffect(() => {
    if (!date) return undefined
    let cancelled = false // ignora respostas de um dia que ja foi trocado
    setSlots({ status: 'loading', rows: [], message: null })
    getAvailableSlots(slug, optionId, date)
      .then((rows) => { if (!cancelled) setSlots({ status: 'ready', rows, message: null }) })
      .catch((err) => { if (!cancelled) setSlots({ status: 'error', rows: [], message: messageFor(err) }) })
    return () => { cancelled = true }
  }, [slug, optionId, date, tick])

  return (
    <div className="stack">
      <h1 ref={h1} tabIndex={-1}>Escolha o dia e o horário</h1>
      {notice && <Notice tone="error">{notice}</Notice>}

      <div className="days" role="group" aria-label="Dias disponíveis para agendar">
        {days.map((d) => {
          const p = dayChipParts(d)
          return (
            <button
              key={d}
              type="button"
              className="chip"
              aria-pressed={d === date}
              aria-label={formatLongDate(d)}
              onClick={() => onDate(d)}
            >
              <span>{p.weekday}</span>
              <span className="day">{p.day}</span>
              <span>{p.month}</span>
            </button>
          )
        })}
      </div>

      <div aria-live="polite" className="stack-sm">
        {!date && <p className="muted">Toque em um dia para ver os horários livres.</p>}
        {date && <h2>Horários em {formatLongDate(date)}</h2>}
        {slots.status === 'loading' && <p className="muted">Buscando horários…</p>}
        {slots.status === 'error' && (
          <>
            <Notice tone="error">{slots.message}</Notice>
            <button type="button" className="btn btn-quiet" onClick={() => setTick((t) => t + 1)}>Tentar novamente</button>
          </>
        )}
        {slots.status === 'ready' && slots.rows.length === 0 && (
          <Notice>Nenhum horário livre neste dia. Escolha outro dia.</Notice>
        )}
        {slots.status === 'ready' && slots.rows.length > 0 && (
          <div className="slots">
            {slots.rows.map((r) => (
              <button
                key={r.starts_at}
                type="button"
                className="slot"
                aria-pressed={slot?.starts_at === r.starts_at}
                onClick={() => onSlot(r)}
              >
                {r.local_time}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!slot} onClick={onNext}>Continuar</button>
      </div>
    </div>
  )
}

import { SIZE_LABELS, formatBRL, formatDuration } from '../../lib/format.js'
import { useFocusOnMount } from './useFocusOnMount.js'

export default function StepService({ services, optionId, onSelect, onNext }) {
  const h1 = useFocusOnMount()
  return (
    <div className="stack">
      <div className="stack-sm">
        <h1 ref={h1} tabIndex={-1}>Escolha o serviço</h1>
        <p className="muted">Selecione também o porte do seu pet: ele define o preço e o tempo.</p>
      </div>
      <fieldset>
        <legend className="sr-only">Serviço e porte do pet</legend>
        {services.map((s) => (
          <div key={s.service_id} role="group" aria-labelledby={`svc-${s.service_id}`}>
            <p className="group-label" id={`svc-${s.service_id}`}>{s.name}</p>
            {s.options.map((o) => (
              <label className="choice" key={o.option_id}>
                <input
                  type="radio"
                  name="option"
                  value={o.option_id}
                  checked={optionId === o.option_id}
                  onChange={() => onSelect(o.option_id)}
                />
                <span className="choice-body">
                  <span className="choice-title">Porte {SIZE_LABELS[o.size].toLowerCase()}</span>
                  <span className="choice-price">{formatBRL(o.price_cents)}</span>
                  <span className="muted small">{formatDuration(o.duration_minutes)}</span>
                </span>
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!optionId} onClick={onNext}>Continuar</button>
      </div>
    </div>
  )
}

import { formatBRL, formatDuration } from '../../lib/format.js'
import { startingPrice } from './serviceSelection.js'

export default function ServiceCard({ service, selectedOptionId, onSelectOption }) {
  const selected = service.options.find((option) => option.option_id === selectedOptionId)

  return (
    <article className="public-service-card">
      <header className="public-service-heading">
        <div>
          <h2>{service.name}</h2>
          {service.description && <p className="service-description">{service.description}</p>}
        </div>
        <p className="service-starting-price">
          <span>A partir de</span>
          <strong>{formatBRL(startingPrice(service.options))}</strong>
        </p>
      </header>
      <fieldset className="public-size-picker">
        <legend>Escolha o porte do pet</legend>
        <div className="public-size-options">
          {service.options.map((option, index) => (
            <button
              key={option.option_id}
              type="button"
              className="public-size-option"
              aria-pressed={selectedOptionId === option.option_id}
              aria-label={`Selecionar porte ${option.size_label}, ${formatBRL(option.price_cents)}`}
              onClick={() => onSelectOption(option.option_id)}
            >
              <span className="size-dog" aria-hidden="true" style={{ fontSize: `${Math.min(1.05 + index * 0.22, 1.7)}rem` }}>🐶</span>
              <span className="size-main">
                <span className="public-size-label">Porte {option.size_label}</span>
                <small>{formatDuration(option.duration_minutes)}</small>
              </span>
              <strong>{formatBRL(option.price_cents)}</strong>
              <span className="size-check" aria-hidden="true">✓</span>
            </button>
          ))}
        </div>
      </fieldset>
      {selected && (
        <p className="public-service-current-price" aria-live="polite">
          Selecionado: porte {selected.size_label} · <strong>{formatBRL(selected.price_cents)}</strong> · {formatDuration(selected.duration_minutes)}
        </p>
      )}
    </article>
  )
}

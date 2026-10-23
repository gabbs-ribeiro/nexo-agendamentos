import { formatBRL, formatDuration } from '../../lib/format.js'
import { displayedPrice, serviceStartingPrice } from './serviceSelection.js'

export default function ServiceCard({ service, selectedOptionId, onSelectOption }) {
  const daily = ['daily', 'stay'].includes(service.booking_mode)
  const periods = service.booking_mode === 'periods'
  const selected = service.options.find((option) => option.option_id === selectedOptionId)

  return (
    <article className="public-service-card" data-booking-mode={service.booking_mode}>
      <header className="public-service-heading">
        <div>
          <h2>{service.name}</h2>
          {service.description && <p className="service-description">{service.description}</p>}
        </div>
        <p className="service-starting-price">
          <span>{daily ? 'Diária a partir de' : 'A partir de'}</span>
          <strong>{formatBRL(serviceStartingPrice(service))}</strong>
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
              aria-label={`Selecionar porte ${option.size_label}, ${formatBRL(displayedPrice(service, option))}${daily ? ' por diária' : ''}`}
              onClick={() => onSelectOption(option.option_id)}
            >
              <span className="size-dog" aria-hidden="true" style={{ fontSize: `${Math.min(1.05 + index * 0.22, 1.7)}rem` }}>🐶</span>
              <span className="size-main">
                <span className="public-size-label">Porte {option.size_label}</span>
                <small>{periods ? 'por período' : daily ? 'por diária' : formatDuration(option.duration_minutes)}</small>
              </span>
              <strong>{formatBRL(displayedPrice(service, option))}</strong>
              <span className="size-check" aria-hidden="true">✓</span>
            </button>
          ))}
        </div>
      </fieldset>
      {selected && (
        <p className="public-service-current-price" aria-live="polite">
          <span className="current-main">
            <span className="current-check" aria-hidden="true">✓</span>
            <span className="sr-only">Selecionado: </span>
            Porte {selected.size_label} · {periods ? 'por período' : daily ? 'por diária' : formatDuration(selected.duration_minutes)}
          </span>
          <strong>{formatBRL(displayedPrice(service, selected))}</strong>
        </p>
      )}
    </article>
  )
}

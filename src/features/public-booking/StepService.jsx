import { useFocusOnMount } from './useFocusOnMount.js'
import ServiceCard from './ServiceCard.jsx'

export default function StepService({ services, optionId, onSelect, onNext }) {
  const h1 = useFocusOnMount()
  return (
    <div className="stack">
      <div className="stack-sm">
        <h1 ref={h1} tabIndex={-1}>Escolha um serviço e porte</h1>
        <p className="muted">Cada horário é reservado para um serviço e um pet. O porte define o preço e a duração.</p>
      </div>
      <div className="public-service-list">
        {services.map((s) => (
          <ServiceCard key={s.service_id} service={s} selectedOptionId={optionId} onSelectOption={onSelect} />
        ))}
      </div>
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!optionId} onClick={onNext}>Continuar</button>
      </div>
    </div>
  )
}

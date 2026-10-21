import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatBRL, formatDuration, whatsappUrl } from '../../lib/format.js'
import Notice from '../../components/Notice.jsx'
import { findSelectedService } from './serviceSelection.js'
import ServiceCard from './ServiceCard.jsx'
import { usePublic } from './usePublic.js'

export default function ServicesPage() {
  const { slug, business, services } = usePublic()
  const [selectedOptionId, setSelectedOptionId] = useState(() => services[0]?.options[0]?.option_id ?? '')
  const selected = findSelectedService(services, selectedOptionId)
  const wa = whatsappUrl(business.contact_phone)

  return (
    <div className="public-home stack">
      <section className="public-welcome-card">
        <p className="eyebrow">Um cuidado especial para o seu pet</p>
        <h1>Bem-vindo(a) à {business.name}!</h1>
        <p>Escolha o serviço e o porte do seu pet para consultar os horários disponíveis.</p>
      </section>

      <section className="public-services-section stack-sm" aria-labelledby="public-services-title">
        <div className="public-section-heading">
          <div>
            <p className="eyebrow">Atendimento com carinho</p>
            <h2 id="public-services-title">Nossos serviços</h2>
          </div>
          <span className="public-service-count">{services.length} {services.length === 1 ? 'serviço' : 'serviços'}</span>
        </div>

        {services.length === 0 ? (
          <Notice>Este estabelecimento ainda não publicou os serviços. Tente novamente mais tarde.</Notice>
        ) : (
          <div className="public-service-list">
            {services.map((service) => (
              <ServiceCard
                key={service.service_id}
                service={service}
                selectedOptionId={selectedOptionId}
                onSelectOption={setSelectedOptionId}
              />
            ))}
          </div>
        )}
      </section>

      {selected && (
        <section className="public-cart-card" aria-labelledby="public-cart-title" aria-live="polite">
          <div className="public-cart-heading">
            <div>
              <p className="eyebrow">Um serviço por horário</p>
              <h2 id="public-cart-title">Seu atendimento</h2>
            </div>
            <span className="public-cart-count">1 pet · 1 serviço</span>
          </div>
          <div className="public-cart-line">
            <div>
              <strong>{selected.service.name}</strong>
              <span>{selected.option.size_label} · {formatDuration(selected.option.duration_minutes)}</span>
            </div>
            <strong className="public-cart-price">{formatBRL(selected.option.price_cents)}</strong>
          </div>
          <p className="small muted">Para incluir outro serviço ou animal, será necessário reservar outro horário.</p>
          <Link
            className="btn btn-primary"
            to={`/${slug}/agendar`}
            state={{ optionId: selected.option.option_id }}
          >
            Escolher dia e horário
          </Link>
        </section>
      )}

      {wa && (
        <p className="public-whatsapp small">
          Ficou com dúvidas? <a href={wa} target="_blank" rel="noopener noreferrer">Fale com o estabelecimento pelo WhatsApp</a>.
        </p>
      )}
    </div>
  )
}

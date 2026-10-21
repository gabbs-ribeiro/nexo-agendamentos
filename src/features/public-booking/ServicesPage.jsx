import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatBRL, formatDuration, whatsappUrl } from '../../lib/format.js'
import Notice from '../../components/Notice.jsx'
import { findSelectedService } from './serviceSelection.js'
import ServiceCard from './ServiceCard.jsx'
import { usePublic } from './usePublic.js'

export default function ServicesPage() {
  const { slug, business, services, categories } = usePublic()
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

        {categories.length === 0 ? (
          <Notice>Este estabelecimento ainda não publicou categorias de serviços.</Notice>
        ) : (
          <div className="public-service-list">
            {categories.map((category) => (
              <section className="public-category-card" key={category.category_id} aria-labelledby={`public-category-${category.category_id}`}>
                <header className="public-category-heading">
                  <div>
                    <h3 id={`public-category-${category.category_id}`}>{category.name}</h3>
                    {category.description && <p>{category.description}</p>}
                  </div>
                  <span>{category.services.length} {category.services.length === 1 ? 'serviço' : 'serviços'}</span>
                </header>
                {category.services.length === 0
                  ? <p className="public-category-empty">Novos serviços desta categoria serão publicados em breve.</p>
                  : <div className="public-category-services">
                    {category.services.map((service) => (
                      <ServiceCard
                        key={service.service_id}
                        service={service}
                        selectedOptionId={selectedOptionId}
                        onSelectOption={setSelectedOptionId}
                      />
                    ))}
                  </div>}
              </section>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <section className="public-cart-card" aria-labelledby="public-cart-title" aria-live="polite">
          <div className="public-cart-line">
            <div id="public-cart-title">
              <strong>{selected.service.name}</strong>
              <span>Porte {selected.option.size_label} · {formatDuration(selected.option.duration_minutes)}</span>
            </div>
            <strong className="public-cart-price">{formatBRL(selected.option.price_cents)}</strong>
          </div>
          <p className="small muted">1 serviço e 1 pet por horário.</p>
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

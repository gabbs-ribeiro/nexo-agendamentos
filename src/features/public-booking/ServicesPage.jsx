import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatBRL, formatDuration, whatsappUrl } from '../../lib/format.js'
import Notice from '../../components/Notice.jsx'
import { findSelectedService } from './serviceSelection.js'
import ServiceCard from './ServiceCard.jsx'
import { usePublic } from './usePublic.js'

// Cor e ícone de cada categoria: pelo nome (banho, hotel, vet...) ou, se não reconhecer, por uma paleta em sequência.
const TONES = [
  { key: 'aqua', icon: '🛁', words: /banho|tosa|higien|estetic|spa|hidrat/ },
  { key: 'amber', icon: '🏡', words: /hotel|creche|hospedag|daycare|day care|pernoit|estadia/ },
  { key: 'mint', icon: '🩺', words: /vet|consult|saude|exame|vacina|clinic/ },
  { key: 'lilac', icon: '🎾', words: /adestr|treino|comport|passeio|recreac/ },
]
const FALLBACK_TONES = ['peach', 'aqua', 'amber', 'mint', 'lilac']
function categoryTone(name, index) {
  const text = (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return TONES.find((tone) => tone.words.test(text)) || { key: FALLBACK_TONES[index % FALLBACK_TONES.length], icon: '🐾' }
}

export default function ServicesPage() {
  const { slug, business, services, categories } = usePublic()
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [expandedCategories, setExpandedCategories] = useState(() => new Set())
  const selected = findSelectedService(services, selectedOptionId)
  const wa = whatsappUrl(business.contact_phone)
  const selectedIsDaily = selected?.service.booking_mode === 'daily'

  function toggleCategory(categoryId) {
    setExpandedCategories((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  return (
    <div className="public-home stack">
      <section className="public-welcome-card">
        <p className="eyebrow">Um cuidado especial para o seu pet</p>
        <h1>Bem-vindo(a) à {business.name}!</h1>
        <p>Escolha o serviço e o porte do seu pet. Nos serviços com hora marcada, você consulta os horários; na hospedagem, escolhe as datas.</p>
      </section>

      <section className="public-services-section stack-sm" aria-labelledby="public-services-title">
        <div className="public-section-heading">
          <div>
            <h2 id="public-services-title">Nossos serviços</h2>
          </div>
          <span className="public-service-count">{services.length} {services.length === 1 ? 'serviço' : 'serviços'}</span>
        </div>

        {categories.length === 0 ? (
          <Notice>Este estabelecimento ainda não publicou categorias de serviços.</Notice>
        ) : (
          <div className="public-service-list">
            {categories.map((category, index) => {
              const tone = categoryTone(category.name, index)
              const expanded = expandedCategories.has(category.category_id)
              return (
                <section
                  className="public-category-card"
                  data-tone={tone.key}
                  key={category.category_id}
                  aria-labelledby={`public-category-${category.category_id}`}
                >
                  <h3 className="sr-only" id={`public-category-${category.category_id}`}>{category.name}</h3>
                  <button
                    type="button"
                    className="public-category-toggle"
                    aria-expanded={expanded}
                    aria-controls={`public-category-content-${category.category_id}`}
                    onClick={() => toggleCategory(category.category_id)}
                  >
                    <span className="public-category-icon" aria-hidden="true">{tone.icon}</span>
                    <span className="public-category-copy">
                      <strong>{category.name}</strong>
                      {category.description && <span>{category.description}</span>}
                    </span>
                    <span className="public-category-arrow" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
                  </button>
                  <div
                    className="public-category-content"
                    id={`public-category-content-${category.category_id}`}
                    hidden={!expanded}
                  >
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
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </section>

      {selected && (
        <section className="public-cart-card" aria-labelledby="public-cart-title" aria-live="polite">
          <div className="public-cart-line">
            <div id="public-cart-title">
              <strong>{selected.service.name}</strong>
              <span>Porte {selected.option.size_label} · {selectedIsDaily ? 'por diária' : formatDuration(selected.option.duration_minutes)}</span>
            </div>
            <strong className="public-cart-price">{formatBRL(selected.option.price_cents)}</strong>
          </div>
          <p className="small muted">{selectedIsDaily ? '1 serviço e 1 pet por reserva.' : '1 serviço e 1 pet por horário.'}</p>
          <Link
            className="btn btn-primary"
            to={selectedIsDaily ? `/${slug}/hospedagem` : `/${slug}/agendar`}
            state={{ optionId: selected.option.option_id }}
          >
            {selectedIsDaily ? 'Escolher entrada e saída' : 'Escolher dia e horário'}
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

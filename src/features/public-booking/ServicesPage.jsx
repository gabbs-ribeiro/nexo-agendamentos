import { Link } from 'react-router-dom'
import { SIZE_LABELS, formatBRL, formatDuration, whatsappUrl } from '../../lib/format.js'
import Notice from '../../components/Notice.jsx'
import { usePublic } from './usePublic.js'

export default function ServicesPage() {
  const { slug, business, services } = usePublic()
  const wa = whatsappUrl(business.contact_phone)

  return (
    <div className="stack">
      <div className="stack-sm">
        <h1>{business.name}</h1>
        <p className="muted">Escolha o serviço e reserve seu horário online.</p>
      </div>

      {services.length === 0 ? (
        <Notice>Este estabelecimento ainda não publicou os serviços. Tente novamente mais tarde.</Notice>
      ) : (
        <ul className="menu" aria-label="Serviços">
          {services.map((s) => (
            <li key={s.service_id}>
              <h2>{s.name}</h2>
              <ul className="prices">
                {s.options.map((o) => (
                  <li key={o.option_id}>
                    <span>{SIZE_LABELS[o.size]}</span>
                    <span className="muted">{formatDuration(o.duration_minutes)}</span>
                    <strong>{formatBRL(o.price_cents)}</strong>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {wa && (
        <p className="small muted">
          Dúvidas? <a href={wa} target="_blank" rel="noopener noreferrer">Fale com o estabelecimento no WhatsApp</a>.
        </p>
      )}

      {services.length > 0 && (
        <div className="actions">
          <Link className="btn btn-primary" to={`/${slug}/agendar`}>Agendar horário</Link>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { listOpenTransport, listReservationsForTransport } from '../../lib/api.js'
import { useAdminBusiness } from '../admin/AdminBusinessContext.jsx'
import TransportPanel from './TransportPanel.jsx'
import { bookingSummary, daycareSummary, staySummary } from './reservationSummary.js'

const KIND_OF = (request) => (request.booking_id ? 'booking' : request.stay_id ? 'stay' : 'daycare')
const ID_OF = (request) => request.booking_id ?? request.stay_id ?? request.daycare_id

/** Pedidos de leva e traz que pedem acao (solicitado ou cotado), na tela inicial. */
export default function TransportInbox() {
  const business = useAdminBusiness()
  const [items, setItems] = useState(null) // null = carregando/indisponivel
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const requests = await listOpenTransport(business.id)
        if (!active) return
        if (requests === null) { setItems(null); return }
        if (requests.length === 0) { setItems([]); return }
        const rows = await listReservationsForTransport(business.id, requests)
        if (!active) return
        const summarize = { booking: bookingSummary, stay: staySummary, daycare: daycareSummary }
        setItems(requests.flatMap((request) => {
          const kind = KIND_OF(request)
          const row = rows[kind].find((candidate) => candidate.id === ID_OF(request))
          // Reserva cancelada/concluida some da caixa: nao ha mais o que fazer.
          return row && row.status === 'confirmed' ? [{ kind, request, reservation: summarize[kind](row, business.timezone) }] : []
        }))
      } catch {
        if (active) setItems(null)
      }
    })()
    return () => { active = false }
  }, [business.id, business.timezone, version])

  if (!items || items.length === 0) return null
  const waiting = items.filter((item) => item.request.status === 'requested').length

  return (
    <section className="transport-inbox stack-sm" aria-labelledby="transport-inbox-title">
      <div className="stay-admin-heading">
        <h2 id="transport-inbox-title"><span aria-hidden="true">🚗</span> Leva e traz</h2>
        <span className="calendar-count">
          {waiting > 0 ? `${waiting} aguardando valor` : `${items.length} em andamento`}
        </span>
      </div>
      <div className="transport-inbox-list">
        {items.map(({ kind, request, reservation }) => (
          <TransportPanel
            key={request.id}
            kind={kind}
            reservation={reservation}
            request={request}
            onChanged={reload}
            title={`${reservation.pet_name} · ${reservation.customer_name}`}
            defaultOpen={request.status === 'requested'}
          />
        ))}
      </div>
    </section>
  )
}

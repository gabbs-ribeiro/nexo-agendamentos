import { TRANSPORT_STATUS_LABELS } from './transportCalc.js'

/** Etiqueta bem visivel de leva e traz nas listas. Some quando nao ha pedido ou foi cancelado. */
export default function TransportBadge({ request }) {
  if (!request || request.status === 'cancelled') return null
  return (
    <span className="transport-badge" data-status={request.status}>
      <span aria-hidden="true">🚗</span> Leva e traz · {TRANSPORT_STATUS_LABELS[request.status]}
    </span>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { getBusinessControl, listTransportFor } from '../../lib/api.js'
import { useAdminBusiness } from '../admin/AdminBusinessContext.jsx'

const ID_COLUMN = { booking: 'booking_id', stay: 'stay_id', daycare: 'daycare_id' }

/**
 * Pedidos de leva e traz das reservas listadas ({ [idDaReserva]: pedido }).
 * available=false quando o recurso nao existe no banco (migration nao aplicada): a tela esconde a secao.
 */
export function useTransportRequests(kind, ids) {
  const business = useAdminBusiness()
  const [state, setState] = useState({ available: true, map: {} })
  const [version, setVersion] = useState(0)
  const key = ids.join(',') // identidade estavel para o efeito (o array novo a cada render)

  useEffect(() => {
    let active = true
    if (!key) {
      setState({ available: true, map: {} })
      return undefined
    }
    listTransportFor(business.id, kind, key.split(','))
      .then((rows) => {
        if (!active) return
        if (rows === null) setState({ available: false, map: {} })
        else setState({ available: true, map: Object.fromEntries(rows.map((row) => [row[ID_COLUMN[kind]], row])) })
      })
    return () => { active = false }
  }, [business.id, kind, key, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { ...state, reload }
}

// Valores padrao do negocio (taxa de partida e valor por km), compartilhados entre as calculadoras.
const FALLBACK = { startFeeCents: 500, kmPriceCents: 100 }
const cache = new Map()
const listeners = new Set()

function fromProfile(profile) {
  return {
    startFeeCents: profile?.transport_start_fee_cents ?? FALLBACK.startFeeCents,
    kmPriceCents: profile?.transport_km_price_cents ?? FALLBACK.kmPriceCents,
  }
}

/** Chamada depois de salvar novos padroes (Controle ou calculadora). */
export function setCachedTransportDefaults(businessId, defaults) {
  cache.set(businessId, defaults)
  listeners.forEach((listener) => listener())
}

export function useTransportDefaults() {
  const business = useAdminBusiness()
  const [defaults, setDefaults] = useState(cache.get(business.id) ?? FALLBACK)

  useEffect(() => {
    let active = true
    const sync = () => { if (active && cache.has(business.id)) setDefaults(cache.get(business.id)) }
    listeners.add(sync)
    if (!cache.has(business.id)) {
      getBusinessControl(business.id)
        .then((profile) => { if (active) setCachedTransportDefaults(business.id, fromProfile(profile)) })
        .catch(() => { /* mantem os padroes de fabrica */ })
    }
    return () => { active = false; listeners.delete(sync) }
  }, [business.id])

  return defaults
}

import { useEffect, useState } from 'react'
import Notice from '../../components/Notice.jsx'
import { saveTransportQuote, setTransportStatus, updateTransportDefaults } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { formatBRL } from '../../lib/format.js'
import { setCachedTransportDefaults, useTransportDefaults } from './useTransport.js'
import { useAdminBusiness } from '../admin/AdminBusinessContext.jsx'
import TransportBadge from './TransportBadge.jsx'
import {
  TRANSPORT_TRIPS_FACTOR, adminWhatsappUrl, calcFreight, centsToInput, kmLabel, mapsSearchUrl,
  parseKm, parseMoneyToCents, totalWithTransport,
} from './transportCalc.js'

const emptyAddress = { street: '', number: '', neighborhood: '', city: '', complement: '', reference: '' }

function addressFromRequest(request) {
  if (!request) return emptyAddress
  return {
    street: request.street ?? '', number: request.street_number ?? '', neighborhood: request.neighborhood ?? '',
    city: request.city ?? '', complement: request.complement ?? '', reference: request.reference ?? '',
  }
}

/**
 * Calculadora do leva e traz de UMA reserva.
 * kind: 'booking' | 'stay' | 'daycare'. reservation: resumo (reservationSummary.js).
 * request: pedido existente (ou undefined). A cotacao nao soma no total; so o "Confirmar" soma.
 */
export default function TransportPanel({ kind, reservation, request, onChanged, title, defaultOpen = false }) {
  const business = useAdminBusiness()
  const defaults = useTransportDefaults()
  const idp = `transport-${reservation.id}`
  const canEdit = reservation.status === 'confirmed' && request?.status !== 'confirmed'

  const [address, setAddress] = useState(() => addressFromRequest(request))
  const [kmText, setKmText] = useState(() => (request?.distance_km != null ? String(request.distance_km).replace('.', ',') : ''))
  const [feeText, setFeeText] = useState(() => centsToInput(request?.start_fee_cents ?? defaults.startFeeCents))
  const [kmPriceText, setKmPriceText] = useState(() => centsToInput(request?.km_price_cents ?? defaults.kmPriceCents))
  const [open, setOpen] = useState(defaultOpen) // controlado: nao fecha sozinho quando o pedido muda de status
  const [pending, setPending] = useState(null) // 'confirm' | 'cancel'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fallbackUrl, setFallbackUrl] = useState('') // quando o navegador bloqueia a aba do WhatsApp

  // Quando o pedido salvo muda (salvou, confirmou, cancelou), o formulario volta a refletir o que esta no banco.
  const savedKey = [request?.id, request?.status, request?.distance_km, request?.start_fee_cents,
    request?.km_price_cents, request?.street, request?.street_number, request?.neighborhood].join('|')
  useEffect(() => {
    setAddress(addressFromRequest(request))
    setKmText(request?.distance_km != null ? String(request.distance_km).replace('.', ',') : '')
    setFeeText(centsToInput(request?.start_fee_cents ?? defaults.startFeeCents))
    setKmPriceText(centsToInput(request?.km_price_cents ?? defaults.kmPriceCents))
    setPending(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  // Sem pedido, acompanha os padroes do negocio ate a responsavel mexer nos campos.
  useEffect(() => {
    if (request?.start_fee_cents == null) setFeeText(centsToInput(defaults.startFeeCents))
    if (request?.km_price_cents == null) setKmPriceText(centsToInput(defaults.kmPriceCents))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.startFeeCents, defaults.kmPriceCents])

  const km = parseKm(kmText)
  const startFee = parseMoneyToCents(feeText)
  const kmPrice = parseMoneyToCents(kmPriceText)
  const calc = km != null && startFee != null && kmPrice != null
    ? calcFreight({ distanceKm: km, startFeeCents: startFee, kmPriceCents: kmPrice }) : null
  const streetOk = address.street.trim().length >= 2
  const saved = request?.freight_cents != null
  const dirty = saved && (
    km !== Number(request.distance_km) || startFee !== request.start_fee_cents || kmPrice !== request.km_price_cents
    || address.street.trim() !== (request.street ?? '') || address.number.trim() !== (request.street_number ?? '')
    || address.neighborhood.trim() !== (request.neighborhood ?? ''))
  const differsFromDefaults = startFee != null && kmPrice != null
    && (startFee !== defaults.startFeeCents || kmPrice !== defaults.kmPriceCents)
  const whatsappUrl = saved && !dirty && request.status !== 'cancelled'
    ? adminWhatsappUrl({
      customerPhone: reservation.customer_phone,
      businessName: business.name,
      customerName: reservation.customer_name,
      petName: reservation.pet_name,
      serviceName: reservation.service_name,
      whenLabel: reservation.whenLabel,
      freightCents: request.freight_cents,
    }) : null

  async function run(action, success) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
      onChanged?.()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  // "Enviar valor pelo WhatsApp" funciona mesmo sem salvar antes: salva a cotacao e abre a conversa.
  async function sendWhatsapp() {
    if (busy) return
    setError('')
    setNotice('')
    setFallbackUrl('')
    const needsSave = !saved || dirty
    if (needsSave && !calc) {
      setError('Informe a distância de ida (km), a taxa de partida e o valor por km para calcular o valor.')
      return
    }
    if (needsSave && !streetOk) {
      setError('Informe a rua do cliente para salvar a cotação.')
      return
    }
    const message = (freightCents) => adminWhatsappUrl({
      customerPhone: reservation.customer_phone,
      businessName: business.name,
      customerName: reservation.customer_name,
      petName: reservation.pet_name,
      serviceName: reservation.service_name,
      whenLabel: reservation.whenLabel,
      freightCents,
    })
    if (!message(0)) {
      setError('O telefone deste cliente não é válido para abrir o WhatsApp.')
      return
    }
    // A aba e aberta AQUI, no clique (antes de esperar o servidor), para o navegador nao bloquear.
    const popup = window.open('about:blank', '_blank')
    if (popup) { try { popup.opener = null } catch { /* segue sem opener */ } }
    setBusy(true)
    try {
      let freightCents = request?.freight_cents
      if (needsSave) {
        const result = await saveTransportQuote({
          kind,
          reservationId: reservation.id,
          address: { ...address, street: address.street.trim() },
          distanceKm: km,
          startFeeCents: startFee,
          kmPriceCents: kmPrice,
        })
        freightCents = result.freight_cents
        onChanged?.()
        setNotice('Cotação salva. O valor ainda não foi somado ao total.')
      }
      const url = message(freightCents)
      if (popup) popup.location.href = url
      else setFallbackUrl(url)
    } catch (err) {
      if (popup) popup.close()
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  const field = (name) => ({
    value: address[name],
    onChange: (event) => setAddress((current) => ({ ...current, [name]: event.target.value })),
  })

  return (
    <details className="transport-panel" data-status={request?.status ?? 'none'} open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="transport-summary-main">
          {title ? <strong>{title}</strong> : <strong><span aria-hidden="true">🚗</span> Leva e traz</strong>}
          {request && request.status !== 'cancelled'
            ? <TransportBadge request={request} />
            : <span className="transport-summary-hint">{request ? 'Pedido cancelado' : 'Sem pedido'}</span>}
        </span>
        {request?.status === 'confirmed' && (
          <span className="transport-summary-total">+ {formatBRL(request.freight_cents)}</span>
        )}
      </summary>

      <div className="transport-body">
        {reservation.status !== 'confirmed' && (
          <p className="hint">Esta reserva não está mais ativa; o leva e traz não pode ser alterado.</p>
        )}
        {request?.status === 'confirmed' && (
          <p className="hint">Leva e traz confirmado: o frete já está somado ao total. Para recalcular, desfaça a confirmação.</p>
        )}

        <fieldset className="transport-fieldset" disabled={!canEdit || busy}>
          <legend>Endereço do cliente</legend>
          <div className="transport-grid">
            <div className="field transport-wide"><label htmlFor={`${idp}-street`}>Rua</label>
              <input id={`${idp}-street`} type="text" maxLength={120} autoComplete="off" {...field('street')} /></div>
            <div className="field"><label htmlFor={`${idp}-number`}>Número</label>
              <input id={`${idp}-number`} type="text" maxLength={20} autoComplete="off" {...field('number')} /></div>
            <div className="field"><label htmlFor={`${idp}-hood`}>Bairro</label>
              <input id={`${idp}-hood`} type="text" maxLength={80} autoComplete="off" {...field('neighborhood')} /></div>
            <div className="field"><label htmlFor={`${idp}-city`}>Cidade</label>
              <input id={`${idp}-city`} type="text" maxLength={80} autoComplete="off" {...field('city')} /></div>
            <div className="field"><label htmlFor={`${idp}-compl`}>Complemento</label>
              <input id={`${idp}-compl`} type="text" maxLength={80} autoComplete="off" {...field('complement')} /></div>
            <div className="field transport-wide"><label htmlFor={`${idp}-ref`}>Ponto de referência</label>
              <input id={`${idp}-ref`} type="text" maxLength={120} autoComplete="off" {...field('reference')} /></div>
          </div>
          {streetOk && (
            <a className="transport-maps" href={mapsSearchUrl(address)} target="_blank" rel="noopener noreferrer">
              Abrir endereço no Maps
            </a>
          )}
        </fieldset>

        <fieldset className="transport-fieldset" disabled={!canEdit || busy}>
          <legend>Cálculo do frete</legend>
          <div className="transport-grid">
            <div className="field transport-wide">
              <label htmlFor={`${idp}-km`}>Distância de ida (km)</label>
              <input id={`${idp}-km`} type="text" inputMode="decimal" placeholder="6" autoComplete="off"
                value={kmText} onChange={(event) => setKmText(event.target.value)} />
              <span className="hint">Informe só a ida (da loja até o cliente). O sistema considera ida e volta da busca e da entrega ({TRANSPORT_TRIPS_FACTOR}×).</span>
            </div>
            <div className="field"><label htmlFor={`${idp}-fee`}>Taxa de partida (R$)</label>
              <input id={`${idp}-fee`} type="text" inputMode="decimal" autoComplete="off"
                value={feeText} onChange={(event) => setFeeText(event.target.value)} /></div>
            <div className="field"><label htmlFor={`${idp}-kmprice`}>Valor por km (R$)</label>
              <input id={`${idp}-kmprice`} type="text" inputMode="decimal" autoComplete="off"
                value={kmPriceText} onChange={(event) => setKmPriceText(event.target.value)} /></div>
          </div>
          {canEdit && differsFromDefaults && (
            <button type="button" className="btn-text transport-default-button" disabled={busy}
              onClick={() => run(async () => {
                await updateTransportDefaults(business.id, { startFeeCents: startFee, kmPriceCents: kmPrice })
                setCachedTransportDefaults(business.id, { startFeeCents: startFee, kmPriceCents: kmPrice })
              }, 'Valores salvos como padrão para as próximas cotações.')}>
              Salvar esses valores como padrão
            </button>
          )}
        </fieldset>

        {calc && (
          <dl className="transport-breakdown" aria-live="polite">
            <div><dt>Distância de ida</dt><dd>{kmLabel(calc.distanceKm)}</dd></div>
            <div><dt>Considerada no cálculo ({TRANSPORT_TRIPS_FACTOR}×)</dt><dd>{kmLabel(calc.totalKm)}</dd></div>
            <div><dt>{kmLabel(calc.totalKm)} × {formatBRL(calc.kmPriceCents)}</dt><dd>{formatBRL(calc.kmCostCents)}</dd></div>
            <div><dt>Taxa de partida</dt><dd>{formatBRL(calc.startFeeCents)}</dd></div>
            <div className="transport-breakdown-total"><dt>Valor do frete</dt><dd>{formatBRL(calc.freightCents)}</dd></div>
            {request?.status === 'confirmed' && (
              <div className="transport-breakdown-total">
                <dt>Total da reserva com leva e traz</dt>
                <dd>{formatBRL(totalWithTransport(reservation.baseCents, request))}</dd>
              </div>
            )}
          </dl>
        )}
        {dirty && <p className="hint">Você alterou os dados. "Enviar valor pelo WhatsApp" salva a cotação antes de abrir a conversa; para confirmar, salve a cotação.</p>}

        {error && <Notice tone="error">{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        {fallbackUrl && (
          <Notice>O navegador bloqueou a abertura do WhatsApp. <a href={fallbackUrl} target="_blank" rel="noopener noreferrer">Abrir conversa no WhatsApp</a></Notice>
        )}

        {pending ? (
          <div className="transport-confirm" role="group" aria-label="Confirmar ação">
            <p>{pending === 'confirm'
              ? `Confirmar o leva e traz? O frete de ${formatBRL(request.freight_cents)} será somado ao total da reserva.`
              : 'Cancelar este pedido de leva e traz? Ele sai do total e você pode cotar de novo depois.'}</p>
            <div className="transport-actions">
              <button type="button" className="btn btn-primary" disabled={busy}
                onClick={() => (pending === 'confirm'
                  ? run(() => setTransportStatus(request.id, 'confirmed'), 'Leva e traz confirmado: o frete foi somado ao total da reserva.')
                  : run(() => setTransportStatus(request.id, 'cancelled'), 'Pedido de leva e traz cancelado.'))}>
                {busy ? 'Salvando…' : pending === 'confirm' ? 'Sim, confirmar' : 'Sim, cancelar pedido'}
              </button>
              <button type="button" className="btn-text" disabled={busy} onClick={() => setPending(null)}>Voltar</button>
            </div>
          </div>
        ) : (
          <div className="transport-actions">
            {canEdit && (
              <button type="button" className="btn btn-primary" disabled={busy || !calc || !streetOk || (saved && !dirty && request.status !== 'cancelled')}
                onClick={() => run(() => saveTransportQuote({
                  kind,
                  reservationId: reservation.id,
                  address: { ...address, street: address.street.trim() },
                  distanceKm: km,
                  startFeeCents: startFee,
                  kmPriceCents: kmPrice,
                }), 'Cotação salva. O valor ainda não foi somado ao total.')}>
                {busy ? 'Salvando…' : saved ? 'Atualizar cotação' : 'Salvar cotação'}
              </button>
            )}
            {whatsappUrl ? (
              <a className="btn btn-quiet" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                Enviar valor pelo WhatsApp
              </a>
            ) : canEdit && (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={sendWhatsapp}>
                Enviar valor pelo WhatsApp
              </button>
            )}
            {request?.status === 'quoted' && !dirty && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setPending('confirm')}>
                Confirmar leva e traz
              </button>
            )}
            {request?.status === 'confirmed' && (
              <button type="button" className="btn btn-quiet" disabled={busy}
                onClick={() => run(() => setTransportStatus(request.id, 'quoted'), 'Confirmação desfeita: o frete saiu do total.')}>
                Desfazer confirmação
              </button>
            )}
            {request && request.status !== 'cancelled' && reservation.status === 'confirmed' && (
              <button type="button" className="btn-text" disabled={busy} onClick={() => setPending('cancel')}>
                Cancelar pedido
              </button>
            )}
          </div>
        )}
        {!saved && canEdit && !request && (
          <p className="hint">Sem pedido do cliente? Preencha o endereço e os km para cotar um leva e traz pedido por fora do site.</p>
        )}
        {request?.requested_by === 'customer' && request.status === 'requested' && (
          <p className="hint">O cliente pediu o leva e traz pelo site. Calcule o valor e envie pelo WhatsApp.</p>
        )}
      </div>
    </details>
  )
}

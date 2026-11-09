import { useEffect, useMemo, useState } from 'react'
import Notice from '../../components/Notice.jsx'
import { listUpcomingReservations, searchReservations } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { todayInTz } from '../../lib/format.js'
import { useTransportRequests } from '../transport/useTransport.js'
import { useAdminBusiness } from './AdminBusinessContext.jsx'
import { dateRangeInTimezone } from './bookingView.js'
import ReservationCard from './ReservationCard.jsx'
import {
  KIND_LABELS, KIND_ORDER, canSearch, dateHeading, filterBySearch, groupByDate, looksLikeCode,
  normalizeFound, normalizeReservation,
} from './upcomingView.js'

/** Todas as reservas marcadas (separadas por tipo e organizadas por data) + busca pelo codigo. */
export default function UpcomingReservations({ onPickDate }) {
  const business = useAdminBusiness()
  const today = todayInTz(business.timezone)
  const [state, setState] = useState({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState({ status: 'idle' }) // idle | loading | done
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    listUpcomingReservations(business.id, { todayYmd: today, startIso: dateRangeInTimezone(today, business.timezone).start })
      .then((data) => {
        if (!active) return
        const items = Object.fromEntries(KIND_ORDER.map((kind) => [
          kind, data[kind].map((row) => normalizeReservation(kind, row, business.timezone)),
        ]))
        setState({ status: 'ready', items, limit: data.limit })
      })
      .catch((error) => { if (active) setState({ status: 'error', message: messageFor(error) }) })
    return () => { active = false }
  }, [business.id, business.timezone, today])

  const items = state.status === 'ready' ? state.items : { booking: [], stay: [], daycare: [] }
  const found = search.status === 'done' ? search.results : []
  const idsOf = (kind) => [...items[kind].map((i) => i.id), ...found.filter((i) => i.kind === kind).map((i) => i.id)]
  const transport = {
    booking: useTransportRequests('booking', idsOf('booking')),
    stay: useTransportRequests('stay', idsOf('stay')),
    daycare: useTransportRequests('daycare', idsOf('daycare')),
  }
  const total = KIND_ORDER.reduce((sum, kind) => sum + items[kind].length, 0)
  const allLoaded = useMemo(() => KIND_ORDER.flatMap((kind) => items[kind]), [state]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submitSearch(event) {
    event.preventDefault()
    setNotice('')
    if (!canSearch(query)) {
      setSearch({ status: 'done', results: [], error: 'Digite pelo menos 2 caracteres do nome do tutor ou do pet, ou 4 caracteres do código.', query })
      return
    }
    setSearch({ status: 'loading' })
    const local = filterBySearch(allLoaded, query)
    try {
      const { results, truncated } = await searchReservations(business.id, query)
      setSearch({ status: 'done', results: results.map((row) => normalizeFound(row, business.timezone)), truncated, query })
    } catch (error) {
      // Sem a busca completa (ex.: banco ainda sem a atualizacao) ainda mostramos o que ja esta na lista.
      if (local.length > 0) {
        setNotice('A busca completa não está disponível agora. Mostrando só os agendamentos marcados listados abaixo.')
        setSearch({ status: 'done', results: local, query })
      } else {
        setSearch({ status: 'done', results: [], error: messageFor(error), query })
      }
    }
  }

  function clearSearch() {
    setQuery('')
    setSearch({ status: 'idle' })
    setNotice('')
  }

  return (
    <section className="upcoming stack" aria-labelledby="upcoming-title">
      <div className="stay-admin-heading">
        <h2 id="upcoming-title">Todos os agendamentos marcados</h2>
        {state.status === 'ready' && <span className="calendar-count">{total} {total === 1 ? 'marcado' : 'marcados'}</span>}
      </div>

      <form className="upcoming-search" role="search" onSubmit={submitSearch}>
        <div className="field">
          <label htmlFor="upcoming-code">Buscar por código, tutor ou pet</label>
          <div className="upcoming-search-row">
            <input id="upcoming-code" type="search" inputMode="text" autoComplete="off" autoCapitalize="characters"
              placeholder="Ex.: AB12CD34 ou nome do tutor" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={search.status === 'loading'}>
              {search.status === 'loading' ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          <span className="hint">Digite o nome do tutor ou do pet (não precisa de acento) ou o código que o cliente recebeu.</span>
        </div>
      </form>

      {search.status === 'done' && (
        <div className="upcoming-results stack-sm" aria-live="polite">
          <div className="stay-admin-heading">
            <h3>Resultado da busca{!search.error && search.results.length > 0 ? ` · ${search.results.length}` : ''}</h3>
            <button type="button" className="btn-text" onClick={clearSearch}>Limpar busca</button>
          </div>
          {search.error && <Notice tone="error">{search.error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          {!search.error && search.results.length === 0 && (
            <p className="agenda-empty">Nenhum agendamento encontrado para “{search.query.trim()}”.</p>
          )}
          {search.results.length > 1 && looksLikeCode(search.query) && (
            <p className="hint">Mais de um resultado. Confira o nome do tutor, do pet e o código.</p>
          )}
          {search.truncated && (
            <p className="hint">Mostrando os 30 mais recentes. Digite mais letras do nome para refinar a busca.</p>
          )}
          {search.results.length > 0 && (
            <ol className="reservation-list">
              {search.results.map((item) => (
                <ReservationCard key={`${item.kind}-${item.id}`} reservation={item} request={transport[item.kind].map[item.id]} onPickDate={onPickDate} />
              ))}
            </ol>
          )}
        </div>
      )}

      {state.status === 'loading' && <p className="status" role="status">Carregando agendamentos…</p>}
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}

      {state.status === 'ready' && KIND_ORDER.map((kind) => (
        <details className="upcoming-kind" key={kind} open>
          <summary>
            <span>{KIND_LABELS[kind]}</span>
            <span className="calendar-count">{items[kind].length}</span>
          </summary>
          {items[kind].length === 0 ? (
            <p className="agenda-empty">Nenhum agendamento marcado.</p>
          ) : (
            <div className="upcoming-groups">
              {groupByDate(items[kind]).map(([ymd, list]) => (
                <section key={ymd} className="upcoming-date-group" aria-label={dateHeading(ymd, today)}>
                  <h3 className="upcoming-date">
                    <button type="button" className="upcoming-date-button" onClick={() => onPickDate?.(ymd)}
                      aria-label={`${dateHeading(ymd, today)}: ver no calendário`}>
                      {dateHeading(ymd, today)}
                    </button>
                    <span className="calendar-count">{list.length}</span>
                  </h3>
                  <ol className="reservation-list">
                    {list.map((item) => (
                      <ReservationCard key={item.id} reservation={item} request={transport[kind].map[item.id]} onPickDate={onPickDate} />
                    ))}
                  </ol>
                </section>
              ))}
              {items[kind].length >= state.limit && (
                <p className="hint">Mostrando os primeiros {state.limit}. Use o calendário ou a busca para ver os demais.</p>
              )}
            </div>
          )}
        </details>
      ))}
    </section>
  )
}

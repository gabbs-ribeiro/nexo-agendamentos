import { useEffect, useState } from 'react'
import Notice from '../../components/Notice.jsx'
import { listAdminBookings } from '../../lib/api.js'
import { ERROR_MESSAGES } from '../../lib/errors.js'
import { todayInTz } from '../../lib/format.js'
import { dateRangeInTimezone } from './bookingView.js'
import { useAdminBusiness } from './AdminBusinessContext.jsx'
import BookingList from './BookingList.jsx'

export default function AgendaPage({ view }) {
  const business = useAdminBusiness()
  const [date, setDate] = useState(() => todayInTz(business.timezone))
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    const range = dateRangeInTimezone(date, business.timezone)
    listAdminBookings(business.id, range.start, range.end)
      .then((bookings) => {
        if (active) setState({ status: 'ready', bookings })
      })
      .catch(() => {
        if (active) setState({ status: 'error' })
      })
    return () => { active = false }
  }, [business.id, business.timezone, date])

  return (
    <section className="stack">
      <div className="stack-sm">
        <h1>{view === 'calendar' ? 'Calendário' : 'Início'}</h1>
        <p className="muted">{business.name} · Compromissos confirmados</p>
      </div>
      <div className="field">
        <label htmlFor="agenda-date">{view === 'calendar' ? 'Escolha uma data' : 'Agendamentos do dia'}</label>
        <input id="agenda-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      {state.status === 'loading' && <p className="status" role="status">Carregando agendamentos…</p>}
      {state.status === 'error' && <Notice tone="error">{ERROR_MESSAGES.NETWORK}</Notice>}
      {state.status === 'ready' && <BookingList bookings={state.bookings} timezone={business.timezone} />}
    </section>
  )
}

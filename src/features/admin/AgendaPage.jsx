import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Notice from '../../components/Notice.jsx'
import { listAdminBookings } from '../../lib/api.js'
import { ERROR_MESSAGES } from '../../lib/errors.js'
import { addDaysYmd, dayChipParts, formatLongDate, todayInTz } from '../../lib/format.js'
import { dateRangeInTimezone } from './bookingView.js'
import { useAdminBusiness } from './AdminBusinessContext.jsx'
import BookingList from './BookingList.jsx'
import BookingShareCard from './BookingShareCard.jsx'
import ManualBookingDialog from './ManualBookingDialog.jsx'

function greeting(timezone) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date()))
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export default function AgendaPage({ view }) {
  const business = useAdminBusiness()
  const isHome = view === 'home'
  const today = todayInTz(business.timezone)
  const [selectedDate, setSelectedDate] = useState(today)
  const date = isHome ? today : selectedDate
  const [state, setState] = useState({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false)
  const [createdFeedback, setCreatedFeedback] = useState(null)

  useEffect(() => {
    setSelectedDate(todayInTz(business.timezone))
  }, [business.id, business.timezone])

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
  }, [business.id, business.timezone, date, reload])

  function handleBookingCreated(result) {
    setBookingDialogOpen(false)
    setCreatedFeedback(result)
    setReload((current) => current + 1)
  }

  function handleBookingUncertain() {
    setBookingDialogOpen(false)
    setCreatedFeedback({ uncertain: true })
    setReload((current) => current + 1)
  }

  const selectedWeek = Array.from({ length: 7 }, (_, index) => addDaysYmd(date, index - 3))

  return (
    <section className="agenda-page">
      {isHome ? (
        <header className="admin-hero">
          <div className="admin-hero-copy">
            <p className="eyebrow">{formatLongDate(today)}</p>
            <h1>{greeting(business.timezone)}! Que bom ter você por aqui.</h1>
            <p>Organize os atendimentos de hoje e cuide de cada pet com carinho.</p>
            {state.status === 'ready' && (
              <strong className="agenda-count">
                {state.bookings.length} {state.bookings.length === 1 ? 'agendamento hoje' : 'agendamentos hoje'}
              </strong>
            )}
          </div>
          <span className="hero-paw" aria-hidden="true">🐾</span>
        </header>
      ) : (
        <header className="calendar-heading">
          <div className="stack-sm">
            <p className="eyebrow">Sua rotina, em um só lugar</p>
            <h1>Calendário</h1>
          </div>
          <button type="button" className="calendar-add-button" aria-label="Adicionar agendamento manualmente"
            onClick={() => setBookingDialogOpen(true)}>+</button>
        </header>
      )}

      {isHome ? (
        <section className="agenda-section stack-sm" aria-labelledby="today-agenda-title">
          <div className="agenda-section-heading">
            <div>
              <p className="eyebrow">Sua agenda</p>
              <h2 id="today-agenda-title">Atendimentos de hoje</h2>
            </div>
            <Link to="/admin/calendario" className="agenda-text-link">Ver calendário</Link>
          </div>
        </section>
      ) : (
        <section className="calendar-date-picker stack-sm" aria-label="Escolher dia da agenda">
          <div className="field calendar-date-field">
            <label htmlFor="agenda-date">Escolha uma data</label>
            <input id="agenda-date" type="date" value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)} />
          </div>
          <div className="days calendar-days" role="group" aria-label="Dias próximos">
            {selectedWeek.map((day) => {
              const parts = dayChipParts(day)
              return (
                <button key={day} type="button" className="chip calendar-day"
                  aria-pressed={day === selectedDate} onClick={() => setSelectedDate(day)}
                  aria-label={formatLongDate(day)}>
                  <span>{parts.weekday}</span><span className="day">{parts.day}</span><span>{parts.month}</span>
                </button>
              )
            })}
          </div>
          <h2 className="calendar-selected-date">{formatLongDate(selectedDate)}</h2>
        </section>
      )}

      {createdFeedback && (
        <Notice tone={createdFeedback.uncertain || !createdFeedback.internalNoteSaved ? 'error' : 'info'}>
          {createdFeedback.uncertain
            ? 'Não foi possível confirmar a criação. Confira a agenda antes de tentar novamente.'
            : createdFeedback.internalNoteSaved
              ? 'Agendamento criado com sucesso.'
              : <>Agendamento criado, mas não foi possível confirmar o salvamento da anotação interna. <Link to={`/admin/agendamentos/${createdFeedback.bookingId}`}>Abra os detalhes para conferir e salvar a anotação.</Link></>}
        </Notice>
      )}
      {state.status === 'loading' && <p className="status" role="status">Carregando agendamentos…</p>}
      {state.status === 'error' && <Notice tone="error">{ERROR_MESSAGES.NETWORK}</Notice>}
      {state.status === 'ready' && (
        <BookingList
          bookings={state.bookings}
          timezone={business.timezone}
          emptyText={isHome ? 'Sem agendamentos por hoje.' : 'Sem agendamentos nesta data.'}
        />
      )}

      {isHome && <BookingShareCard slug={business.slug} businessName={business.name} />}

      {!isHome && (
        <ManualBookingDialog
          open={bookingDialogOpen}
          business={business}
          initialDate={selectedDate}
          onCancel={() => setBookingDialogOpen(false)}
          onCreated={handleBookingCreated}
          onUncertain={handleBookingUncertain}
        />
      )}
    </section>
  )
}

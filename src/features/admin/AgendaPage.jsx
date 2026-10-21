import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import Notice from '../../components/Notice.jsx'
import {
  createAdminTimeBlock,
  deleteAdminTimeBlock,
  listAdminBookingConflicts,
  listAdminBookings,
  listAdminTimeBlocks,
  setAdminBookingStatus,
} from '../../lib/api.js'
import { ERROR_MESSAGES, messageFor } from '../../lib/errors.js'
import { addDaysYmd, dayChipParts, formatInstant, formatLongDate, todayInTz } from '../../lib/format.js'
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
  const [completionTarget, setCompletionTarget] = useState(null)
  const [completionError, setCompletionError] = useState('')
  const [completionBusy, setCompletionBusy] = useState(false)
  const [completionNotice, setCompletionNotice] = useState('')
  const [holidayTarget, setHolidayTarget] = useState(null)
  const [holidayError, setHolidayError] = useState('')
  const [holidayWarning, setHolidayWarning] = useState('')
  const [holidayBusy, setHolidayBusy] = useState(false)
  const [holidayNotice, setHolidayNotice] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setSelectedDate(todayInTz(business.timezone))
  }, [business.id, business.timezone])

  useEffect(() => {
    setHolidayWarning('')
    setHolidayError('')
    setHolidayNotice('')
    setHolidayTarget(null)
  }, [selectedDate])

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    const range = dateRangeInTimezone(date, business.timezone)
    Promise.all([
      listAdminBookings(business.id, range.start, range.end),
      isHome ? Promise.resolve([]) : listAdminTimeBlocks(business.id, range.start, range.end),
      isHome ? Promise.resolve([]) : listAdminBookingConflicts(business.id, range.start, range.end),
    ])
      .then(([bookings, blocks, conflicts]) => {
        if (active) setState({ status: 'ready', bookings, blocks, conflicts })
      })
      .catch(() => {
        if (active) setState({ status: 'error' })
      })
    return () => { active = false }
  }, [business.id, business.timezone, date, isHome, reload])

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

  async function completeBooking() {
    if (!completionTarget || completionBusy) return
    setCompletionBusy(true)
    setCompletionError('')
    setCompletionNotice('')
    try {
      await setAdminBookingStatus(completionTarget.id, 'completed')
      setCompletionTarget(null)
      setCompletionNotice('Agendamento concluído.')
      setReload((current) => current + 1)
    } catch (error) {
      setCompletionError(messageFor(error))
    } finally {
      setCompletionBusy(false)
    }
  }

  const holidayBlock = state.status === 'ready'
    ? state.blocks.find((block) => block.reason === 'Folga')
    : null

  function requestHolidayChange() {
    if (state.status !== 'ready' || holidayBusy) return
    setHolidayWarning('')
    setHolidayNotice('')
    setHolidayError('')
    if (holidayBlock) {
      setHolidayTarget({ kind: 'remove', block: holidayBlock })
      return
    }
    if (selectedDate < todayInTz(business.timezone)) {
      setHolidayWarning('Não é possível marcar folga em uma data que já passou.')
      return
    }
    if (state.blocks.length) {
      setHolidayWarning('Já existe um bloqueio neste dia. Não é possível marcar outra folga enquanto ele estiver ativo.')
      return
    }
    if (state.conflicts.length) {
      const hasConfirmed = state.conflicts.some((booking) => booking.status === 'confirmed')
      setHolidayWarning(hasConfirmed
        ? 'Não é possível marcar folga enquanto houver agendamentos neste dia. Cancele os atendimentos confirmados e tente novamente.'
        : 'Não é possível marcar folga: há um agendamento concluído ou registrado neste dia.')
      return
    }
    setHolidayTarget({ kind: 'create' })
  }

  async function confirmHolidayChange() {
    if (!holidayTarget || holidayBusy) return
    setHolidayBusy(true)
    setHolidayError('')
    try {
      const range = dateRangeInTimezone(selectedDate, business.timezone)
      if (holidayTarget.kind === 'create') {
        await createAdminTimeBlock(business.id, range.start, range.end, 'Folga')
        setHolidayNotice('Folga marcada. O dia está bloqueado para novas reservas.')
      } else {
        await deleteAdminTimeBlock(business.id, holidayTarget.block.id)
        setHolidayNotice('Folga removida. A disponibilidade do dia voltou a ser calculada pelo sistema.')
      }
      setHolidayTarget(null)
      setReload((current) => current + 1)
    } catch (error) {
      setHolidayError(error?.code === 'BOOKING_CONFLICT'
        ? 'Não é possível marcar folga: existe um agendamento neste dia. Cancele os atendimentos confirmados e tente novamente.'
        : messageFor(error))
    } finally {
      setHolidayBusy(false)
    }
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

      {!isHome && (
        <section className="calendar-day-controls" aria-label="Disponibilidade da data selecionada">
          <div>
            <p className="eyebrow">Disponibilidade do dia</p>
            <p className="muted">{holidayBlock
              ? 'Esta data está marcada como folga e bloqueada para novas reservas.'
              : 'Marque uma folga para bloquear o dia inteiro no fuso do estabelecimento.'}</p>
          </div>
          <button type="button" className={holidayBlock ? 'btn btn-quiet' : 'btn btn-primary'}
            disabled={state.status !== 'ready' || holidayBusy}
            onClick={requestHolidayChange}>
            {holidayBlock ? 'Remover folga' : 'Marcar folga'}
          </button>
          {holidayWarning && <Notice tone="error">{holidayWarning}</Notice>}
          {holidayNotice && <Notice>{holidayNotice}</Notice>}
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
      {completionNotice && <Notice>{completionNotice}</Notice>}
      {state.status === 'loading' && <p className="status" role="status">Carregando agendamentos…</p>}
      {state.status === 'error' && <Notice tone="error">{ERROR_MESSAGES.NETWORK}</Notice>}
      {state.status === 'ready' && (
        <BookingList
          bookings={state.bookings}
          timezone={business.timezone}
          now={now}
          completingBookingId={completionBusy ? completionTarget?.id : null}
          onComplete={(booking) => {
            setCompletionTarget(booking)
            setCompletionError('')
          }}
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

      <ConfirmDialog
        open={Boolean(completionTarget)}
        title="Concluir este agendamento?"
        description={completionTarget
          ? `${completionTarget.pet_name} · ${formatInstant(completionTarget.starts_at, business.timezone).date}, das ${formatInstant(completionTarget.starts_at, business.timezone).time} às ${formatInstant(completionTarget.ends_at, business.timezone).time}. O compromisso permanecerá na agenda identificado como concluído.`
          : ''}
        cancelLabel="Não, voltar"
        confirmLabel="Sim, concluir"
        busy={completionBusy}
        error={completionError}
        onCancel={() => { setCompletionTarget(null); setCompletionError('') }}
        onConfirm={completeBooking}
      />

      <ConfirmDialog
        open={Boolean(holidayTarget)}
        title={holidayTarget?.kind === 'remove' ? 'Remover folga deste dia?' : 'Marcar este dia como folga?'}
        description={holidayTarget?.kind === 'remove'
          ? `${formatLongDate(selectedDate)} voltará a aceitar reservas conforme os horários de funcionamento e a disponibilidade calculada pelo banco.`
          : `${formatLongDate(selectedDate)} ficará bloqueado para novas reservas durante todo o dia no fuso do estabelecimento. O banco verificará novamente se há agendamentos antes de criar o bloqueio.`}
        cancelLabel="Voltar"
        confirmLabel={holidayTarget?.kind === 'remove' ? 'Sim, remover folga' : 'Sim, marcar folga'}
        busy={holidayBusy}
        error={holidayError}
        onCancel={() => { setHolidayTarget(null); setHolidayError('') }}
        onConfirm={confirmHolidayChange}
      />
    </section>
  )
}

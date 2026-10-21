import { useCallback, useEffect, useState } from 'react'
import Notice from '../../components/Notice.jsx'
import { listBusinessHours, replaceBusinessHours } from '../../lib/api.js'
import { messageFor } from '../../lib/errors.js'
import { businessHoursDraft, businessHoursPayload, WEEKDAYS } from './businessHours.js'

export default function BusinessHoursSection({ businessId }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await listBusinessHours(businessId)
      setDraft(businessHoursDraft(rows))
    } catch (loadError) {
      setError(messageFor(loadError))
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => { load() }, [load])

  function updateInterval(day, index, field, value) {
    setDraft((current) => ({
      ...current,
      [day]: current[day].map((interval, intervalIndex) => (
        intervalIndex === index ? { ...interval, [field]: value } : interval
      )),
    }))
  }

  function addInterval(day) {
    setDraft((current) => ({
      ...current,
      [day]: [...current[day], { opens_at: '', closes_at: '' }],
    }))
    setError('')
    setNotice('')
  }

  function removeInterval(day, index) {
    setDraft((current) => ({
      ...current,
      [day]: current[day].filter((_, intervalIndex) => intervalIndex !== index),
    }))
    setError('')
    setNotice('')
  }

  async function save(event) {
    event.preventDefault()
    if (saving || !draft) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      let hours
      try {
        hours = businessHoursPayload(draft)
      } catch {
        setError('Confira os horários: o fechamento deve ser posterior à abertura e as faixas do mesmo dia não podem se sobrepor.')
        return
      }
      await replaceBusinessHours(businessId, hours)
      setNotice('Horários de funcionamento atualizados.')
      await load()
    } catch (saveError) {
      setError(messageFor(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="control-card stack" aria-labelledby="business-hours-title">
      <div className="control-section-heading">
        <div>
          <span className="eyebrow">Disponibilidade do estabelecimento</span>
          <h2 id="business-hours-title">Horário de funcionamento</h2>
        </div>
        <span className="control-icon" aria-hidden="true">◷</span>
      </div>
      <p className="muted">Configure os dias e períodos disponíveis para novas reservas. Você pode adicionar mais de um intervalo no mesmo dia, como manhã e tarde. Os horários seguem o fuso do estabelecimento.</p>
      {loading && <p className="status" role="status">Carregando horários…</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {!loading && draft && <form className="business-hours-form stack" onSubmit={save}>
        {WEEKDAYS.map(({ value, label }) => (
          <fieldset className="business-hours-day" key={value}>
            <legend>
              <span>{label}</span>
              <span className="muted small">{draft[value].length ? 'Com expediente' : 'Sem expediente'}</span>
            </legend>
            {draft[value].map((interval, index) => (
              <div className="business-hours-interval" key={`${value}-${interval.id ?? index}`}>
                <div className="field">
                  <label htmlFor={`hours-${value}-${index}-open`}>Abre</label>
                  <input id={`hours-${value}-${index}-open`} type="time" step="60" required
                    value={interval.opens_at}
                    onChange={(event) => updateInterval(value, index, 'opens_at', event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor={`hours-${value}-${index}-close`}>Fecha</label>
                  <input id={`hours-${value}-${index}-close`} type="time" step="60" required
                    value={interval.closes_at}
                    onChange={(event) => updateInterval(value, index, 'closes_at', event.target.value)} />
                </div>
                <button className="btn-text business-hours-remove" type="button"
                  aria-label={`Remover intervalo ${index + 1} de ${label}`}
                  onClick={() => removeInterval(value, index)}>Remover período</button>
              </div>
            ))}
            <button className="btn btn-quiet business-hours-add" type="button" onClick={() => addInterval(value)}>
              Adicionar período
            </button>
          </fieldset>
        ))}
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Salvando horários…' : 'Salvar horário de funcionamento'}
        </button>
      </form>}
      {!loading && !draft && <button className="btn btn-quiet" type="button" onClick={load}>Tentar novamente</button>}
    </section>
  )
}

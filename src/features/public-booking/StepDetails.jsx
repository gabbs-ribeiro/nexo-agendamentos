import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { maskPhone } from '../../lib/format.js'
import Notice from '../../components/Notice.jsx'
import { useFocusOnMount } from './useFocusOnMount.js'
import { validateDetails } from './validation.js'

function Field({ id, label, error, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  )
}

export default function StepDetails({ slug, form, onField, onSubmit, submitting, failure }) {
  const h1 = useFocusOnMount()
  const formRef = useRef(null)
  const [errors, setErrors] = useState({})

  const aria = (name, hint) => ({
    'aria-invalid': errors[name] ? 'true' : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : hint ? `${name}-hint` : undefined,
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    const found = validateDetails(form)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus())
      return
    }
    onSubmit()
  }

  return (
    <form ref={formRef} className="stack" onSubmit={handleSubmit} noValidate>
      <h1 ref={h1} tabIndex={-1}>Seus dados</h1>

      <Field id="name" label="Seu nome" error={errors.name}>
        <input id="name" type="text" autoComplete="name" maxLength={100} value={form.name}
          onChange={(e) => onField('name', e.target.value)} {...aria('name')} />
      </Field>

      <Field id="phone" label="Telefone com DDD" error={errors.phone} hint="Usado só para o estabelecimento falar com você sobre o agendamento.">
        <input id="phone" type="tel" inputMode="tel" autoComplete="tel-national" value={form.phone}
          onChange={(e) => onField('phone', maskPhone(e.target.value))} {...aria('phone', true)} />
      </Field>

      <Field id="petName" label="Nome do pet" error={errors.petName}>
        <input id="petName" type="text" maxLength={60} value={form.petName}
          onChange={(e) => onField('petName', e.target.value)} {...aria('petName')} />
      </Field>

      <Field id="petBreed" label="Raça (opcional)" error={errors.petBreed}>
        <input id="petBreed" type="text" maxLength={60} value={form.petBreed}
          onChange={(e) => onField('petBreed', e.target.value)} {...aria('petBreed')} />
      </Field>

      <Field id="notes" label="Observações (opcional)" error={errors.notes} hint="Ex.: alergias, pelos embaraçados, medo de secador.">
        <textarea id="notes" maxLength={500} value={form.notes}
          onChange={(e) => onField('notes', e.target.value)} {...aria('notes', true)} />
      </Field>

      <div className="field">
        <label className="consent" htmlFor="consent">
          <input id="consent" type="checkbox" checked={form.consent}
            onChange={(e) => onField('consent', e.target.checked)} {...aria('consent')} />
          <span>
            Li e aceito o{' '}
            <Link to={`/${slug}/privacidade`} target="_blank" rel="noopener noreferrer">aviso de privacidade</Link>.
          </span>
        </label>
        {errors.consent && <p className="field-error" id="consent-error">{errors.consent}</p>}
      </div>

      {failure && (
        <Notice tone="error">
          {failure.message}
          {failure.code === 'NETWORK' && ' Seus dados foram mantidos: toque em Confirmar para tentar de novo, sem risco de reservar duas vezes.'}
        </Notice>
      )}

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Confirmando…' : 'Confirmar agendamento'}
        </button>
      </div>
    </form>
  )
}

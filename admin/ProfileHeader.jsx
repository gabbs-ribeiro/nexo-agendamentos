import { useEffect, useRef, useState } from 'react'
import { IconCamera } from '../../components/ControlBar.jsx'
import Notice from '../../components/Notice.jsx'
import { logoUrl } from '../../lib/api.js'

function Avatar({ path, name }) {
  const [failed, setFailed] = useState(false)
  const url = logoUrl(path)
  useEffect(() => { setFailed(false) }, [url])
  if (!url || failed) {
    return <span className="control-avatar-fallback" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
  }
  return <img className="control-avatar" src={url} alt="" onError={() => setFailed(true)} />
}

/** Topo do Controle: foto grande clicavel (abre o seletor de arquivo) e nome do estabelecimento. */
export default function ProfileHeader({ name, logoPath, busy, error, notice, onPickFile }) {
  const inputRef = useRef(null)
  return (
    <section className="control-profile" aria-labelledby="control-profile-name">
      <button
        type="button"
        className="control-photo"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="Alterar foto do perfil"
        aria-busy={busy}
      >
        <Avatar path={logoPath} name={name} />
        <span className="control-photo-badge" aria-hidden="true"><IconCamera /></span>
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = '' // permite escolher o mesmo arquivo de novo depois de um erro
          if (file) onPickFile(file)
        }}
      />
      <div className="control-profile-text">
        <h1 id="control-profile-name">{name}</h1>
        <p className="muted small">{busy ? 'Enviando a nova foto…' : 'Toque na foto para alterar.'}</p>
      </div>
      <div className="control-profile-message" aria-live="polite">
        {error && <Notice tone="error">{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
      </div>
    </section>
  )
}

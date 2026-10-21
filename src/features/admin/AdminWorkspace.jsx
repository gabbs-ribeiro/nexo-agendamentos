import { useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { ERROR_MESSAGES } from '../../lib/errors.js'
import { supabase } from '../../lib/supabase.js'
import AgendaPage from './AgendaPage.jsx'
import { AdminBusinessProvider } from './AdminBusinessContext.jsx'
import BookingDetailsPage from './BookingDetailsPage.jsx'
import ControlPage from './ControlPage.jsx'

export default function AdminWorkspace({ businesses }) {
  const navigate = useNavigate()
  const [businessId, setBusinessId] = useState(businesses[0].id)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const business = businesses.find((item) => item.id === businessId) ?? businesses[0]

  async function logout() {
    if (logoutBusy) return
    setLogoutBusy(true)
    setLogoutError('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setLogoutError(ERROR_MESSAGES.AUTH_LOGOUT_FAILED)
        return
      }
      setConfirmLogout(false)
      navigate('/login', { replace: true })
    } catch {
      setLogoutError(ERROR_MESSAGES.AUTH_LOGOUT_FAILED)
    } finally {
      setLogoutBusy(false)
    }
  }

  return (
    <AdminBusinessProvider business={business}>
      <div className="admin-shell">
        <header className="admin-header">
          <Link to="/admin" className="admin-brand">Nexo Agendamentos</Link>
          {businesses.length > 1 && (
            <div className="field admin-business-picker">
              <label htmlFor="admin-business">Estabelecimento</label>
              <select id="admin-business" value={business.id} onChange={(event) => setBusinessId(event.target.value)}>
                {businesses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
          )}
          <button type="button" className="btn-text" onClick={() => { setLogoutError(''); setConfirmLogout(true) }}>
            Sair
          </button>
        </header>
        <nav className="admin-nav" aria-label="Navegação administrativa">
          <NavLink to="/admin" end>Início</NavLink>
          <NavLink to="/admin/calendario">Calendário</NavLink>
          <NavLink to="/admin/controle">Controle</NavLink>
        </nav>
        <main className="admin-content">
          <Routes>
            <Route index element={<AgendaPage view="home" />} />
            <Route path="calendario" element={<AgendaPage view="calendar" />} />
            <Route path="controle" element={<ControlPage />} />
            <Route path="agendamentos/:bookingId" element={<BookingDetailsPage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
        <ConfirmDialog
          open={confirmLogout}
          title="Deseja sair da sua conta?"
          confirmLabel="Sim, sair"
          busy={logoutBusy}
          error={logoutError}
          onCancel={() => { setConfirmLogout(false); setLogoutError('') }}
          onConfirm={logout}
        />
      </div>
    </AdminBusinessProvider>
  )
}

import { Route, Routes } from 'react-router-dom'
import PublicLayout from './features/public-booking/PublicLayout.jsx'
import ServicesPage from './features/public-booking/ServicesPage.jsx'
import BookingPage from './features/public-booking/BookingPage.jsx'
import ConfirmedPage from './features/public-booking/ConfirmedPage.jsx'
import StayPage from './features/public-booking/StayPage.jsx'
import StayConfirmedPage from './features/public-booking/StayConfirmedPage.jsx'
import PeriodPage from './features/public-booking/PeriodPage.jsx'
import PeriodConfirmedPage from './features/public-booking/PeriodConfirmedPage.jsx'
import PrivacyPage from './features/public-booking/PrivacyPage.jsx'
import LoginPage from './features/auth/LoginPage.jsx'
import AdminAccessPage from './features/auth/AdminAccessPage.jsx'

function Simple({ title, children }) {
  return (
    <div className="shell">
      <main className="page stack">
        <h1>{title}</h1>
        <p className="muted">{children}</p>
      </main>
      <footer className="site-footer small muted">Nexo Agendamentos</footer>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Simple title="Agendamentos">Acesse o link enviado pelo seu estabelecimento para agendar.</Simple>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/*" element={<AdminAccessPage />} />
      <Route path="/:slug" element={<PublicLayout />}>
        <Route index element={<ServicesPage />} />
        <Route path="agendar" element={<BookingPage />} />
        <Route path="confirmado" element={<ConfirmedPage />} />
        <Route path="hospedagem" element={<StayPage />} />
        <Route path="hospedagem/confirmado" element={<StayConfirmedPage />} />
        <Route path="periodos" element={<PeriodPage />} />
        <Route path="periodos/confirmado" element={<PeriodConfirmedPage />} />
        <Route path="privacidade" element={<PrivacyPage />} />
        <Route path="*" element={<Simple title="Página não encontrada">Confira o link com o estabelecimento.</Simple>} />
      </Route>
      <Route path="*" element={<Simple title="Página não encontrada">Confira o link com o estabelecimento.</Simple>} />
    </Routes>
  )
}

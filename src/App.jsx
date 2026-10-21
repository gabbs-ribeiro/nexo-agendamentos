import { Route, Routes } from 'react-router-dom'
import PublicLayout from './features/public-booking/PublicLayout.jsx'
import ServicesPage from './features/public-booking/ServicesPage.jsx'
import BookingPage from './features/public-booking/BookingPage.jsx'
import ConfirmedPage from './features/public-booking/ConfirmedPage.jsx'
import PrivacyPage from './features/public-booking/PrivacyPage.jsx'

function Simple({ title, children }) {
  return (
    <main className="page stack">
      <h1>{title}</h1>
      <p className="muted">{children}</p>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Simple title="Agendamentos">Acesse o link enviado pelo seu estabelecimento para agendar.</Simple>} />
      {/* PROXIMO PASSO (item 3): rotas /login e /admin/* entram AQUI, antes de "/:slug".
          O React Router da prioridade a rotas estaticas; "admin" e "login" ja sao slugs reservados no banco. */}
      <Route path="/:slug" element={<PublicLayout />}>
        <Route index element={<ServicesPage />} />
        <Route path="agendar" element={<BookingPage />} />
        <Route path="confirmado" element={<ConfirmedPage />} />
        <Route path="privacidade" element={<PrivacyPage />} />
        <Route path="*" element={<Simple title="Página não encontrada">Confira o link com o estabelecimento.</Simple>} />
      </Route>
      <Route path="*" element={<Simple title="Página não encontrada">Confira o link com o estabelecimento.</Simple>} />
    </Routes>
  )
}

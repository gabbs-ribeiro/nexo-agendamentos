import { Link } from 'react-router-dom'
import { usePublic } from './usePublic.js'

// ATENCAO: texto-base simples. O responsavel pelo negocio deve revisar (prazo de guarda e canal de
// contato) antes de abrir ao publico. Nao e parecer juridico.
export default function PrivacyPage() {
  const { slug, business } = usePublic()
  return (
    <div className="stack">
      <h1>Aviso de privacidade</h1>
      <p>
        Ao agendar em <strong>{business.name}</strong>, você informa nome, telefone, nome do pet e,
        se quiser, raça e observações.
      </p>
      <p>
        Usamos esses dados somente para registrar e atender o seu agendamento. Quem tem acesso é o
        responsável pelo estabelecimento. Os dados não são vendidos nem usados para publicidade de terceiros.
      </p>
      <p>
        Para corrigir ou apagar seus dados, entre em contato diretamente com o estabelecimento.
      </p>
      <Link className="btn btn-quiet" to={`/${slug}`}>Voltar</Link>
    </div>
  )
}

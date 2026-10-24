import { whatsappUrl } from '../lib/format.js'

/** Telefone do cliente como link que abre a conversa no WhatsApp; se o número não for válido, cai para ligação (tel:). */
export default function PhoneWhatsApp({ phone }) {
  const url = whatsappUrl(phone)
  if (!url) return <a href={`tel:${phone}`}>{phone}</a>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir conversa no WhatsApp"
      aria-label={`${phone}, abrir conversa no WhatsApp`}>
      {phone}
    </a>
  )
}

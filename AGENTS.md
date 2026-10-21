# AGENTS.md — Nexo Agendamentos

Leia `docs/HANDOFF_COPILOT.md` (estado, contrato do banco, pendências) e `docs/TESTES.md` antes de qualquer tarefa. As decisões em §3 do handoff estão **aprovadas**: não reabrir.

## Stack
React + Vite (JavaScript), Supabase (Postgres, Auth, Storage), Vercel, GitHub. Não adicionar dependências/tecnologias sem justificar por escrito.

## Regras inegociáveis
1. **Segredos:** nunca usar `service_role`, `sb_secret_…`, `DATABASE_URL`, `POSTGRES_*` no front, em `VITE_*`, no Git ou em logs. O front só usa a chave anon/publishable. Não commitar `.env*` (exceto `.env.example`).
2. **Regras no banco, não no front.** Disponibilidade, conflitos, gap, expediente, bloqueios, fuso e antecedência são do Postgres (`app_private.compute_slots`). O front só exibe e coleta dados.
3. **Escrita de agendamentos e bloqueios só por RPC** (`create_public_booking`, `admin_*`). Nunca `insert/update` direto em `bookings` ou para criar `time_blocks`. O papel `anon` não lê tabelas.
4. **Banco:** mudou algo → **nova migration** em `supabase/migrations/` com timestamp maior que o último; nunca editar migration já aplicada. Toda função nova em `public`: `security definer`, `set search_path = ''`, `revoke execute … from public, anon, authenticated` e `grant` mínimo. Depois, atualizar/rodar `supabase/tests/` (01–04) e `docs/TESTES.md`.
5. **Não executar SQL em produção nem alterar o Supabase/Vercel sem aprovação humana explícita.** Propor o SQL e esperar.
6. **Segurança só vale com teste executado.** Não afirmar que algo é seguro/pronto sem dizer qual teste rodou e onde.
7. **Datas e horas:** sempre no fuso do negócio (`businesses.timezone`), nunca no do navegador. Enviar o `starts_at` exato devolvido pelo banco; exibir `local_time`. Preço em centavos (`price_cents`); formatar com `Intl.NumberFormat('pt-BR')`.
8. **Idempotência:** gerar `p_idempotency_key` (UUID) uma vez por confirmação e reutilizar em retries.
9. **Erros:** só mensagens mapeadas em `src/lib/errors.js` (por código). Nunca exibir texto bruto do banco/rede; nunca logar dados pessoais.
10. Interface e textos em **português do Brasil**; mobile-first; acessível (teclado, foco visível, `aria`); mesma linguagem visual existente (`src/styles/global.css`). Simplicidade antes de abstração (MVP).

## Como trabalhar
- Entregas pequenas e completas, uma pendência de cada vez, na ordem de `docs/HANDOFF_COPILOT.md` §9.
- Antes de concluir: `npm test` (19 pass) e conferir que `npm run build` passa. Se não puder rodar, diga.
- Lógica pura nova (datas, validação, conversões) vai em módulo sem React e com teste em `tests-front/`.
- Atualizar `docs/HANDOFF_COPILOT.md` (estado) ao fechar cada pendência.

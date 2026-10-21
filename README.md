# Nexo Agendamentos (Nexo Labs)

Sistema de agendamento multi-negócio. MVP: banho e tosa de pets. Stack: React + Vite, Supabase (Postgres + Auth), Vercel.

> **Status atual:** migrations e testes SQL 01–07 foram executados em DEV, conforme confirmação do responsável; URL e chave pública anon estão na Vercel; usuário responsável foi criado manualmente no Supabase Auth. O front inclui agendamento público, login e uma primeira versão de Início/Calendário, detalhes e cancelamento de agendamentos. A nova migration de notas internas e os testes relacionados ainda precisam ser aplicados em DEV; demais telas administrativas também estão pendentes.

## Estrutura
```
src/                   # front React (agendamento público, login e primeira versão de agenda admin)
tests-front/           # testes Node do front (npm test)
supabase/migrations/   # SQL versionado (migrations novas precisam ser aplicadas em DEV)
supabase/tests/        # testes de isolamento, regras, admin, auditoria e concorrência
supabase/seed/         # provisionamento manual de negócio (modelo, sem dados reais)
docs/                  # HANDOFF_COPILOT.md, TESTES.md
.github/copilot-instructions.md
.env.example
```

## Supabase: estado e configuração
- As migrations até `20261020000007` e os testes SQL 01–07 já foram executados, conforme confirmação do responsável pelo projeto. A migration `20261021000001_booking_internal_notes.sql` e o teste SQL 08 são novos e ainda precisam ser aplicados/executados no DEV. Consulte `docs/TESTES.md` para os passos.
- O usuário responsável já foi criado manualmente no Supabase Auth; não há cadastro público no aplicativo.
- A URL do projeto e a chave pública anon já foram configuradas nas variáveis de ambiente da Vercel. Nunca configure `service_role` ou `sb_secret_...` no frontend ou em variáveis `VITE_*`.
- O login está disponível em `/login`. Para liberar o acesso administrativo, a conta também precisa ter vínculo com o negócio em `business_members` (papel `owner`). A interface confere sessão e vínculo; autenticar sozinho não concede acesso.
- O painel inicial lista os agendamentos confirmados por dia; Calendário e Início abrem a tela detalhada. Detalhes usam snapshots do agendamento, oferecem edição de dados permitidos, notas internas e cancelamento com confirmação. Serviços e outras telas administrativas ainda não estão implementados.
- Os detalhes internos da configuração e as pendências de validação estão em `docs/HANDOFF_COPILOT.md` e `docs/TESTES.md`.

## Front: rodar localmente
`cp .env.example .env.local` (preencher com URL e chave **anon** do projeto de DEV) → `npm install` → `npm run dev`. Testes do front: `npm test` (25 testes). Build: `npm run build`. Páginas: `/<slug>` (cliente), `/login` e `/admin` (responsável). O painel administrativo completo ainda precisa ser desenvolvido. A chave `service_role` nunca entra no frontend.

## Backup manual mensal (decisão D15)
O plano gratuito não deve ser tratado como garantia de backup. Uma vez por mês (e antes de qualquer migration em produção):
1. **Exportar:** no painel do Supabase, Table Editor → exportar CSV de `bookings`, `services`, `service_options`, `business_hours`, `time_blocks`, `businesses` **ou**, na sua máquina, `pg_dump "$DATABASE_URL" --no-owner -Fc -f nexo-AAAA-MM.dump` (a `DATABASE_URL` com senha fica só no seu computador, nunca no Git/Vercel).
2. **Guardar com segurança:** os arquivos têm telefones e nomes de clientes (dados pessoais, LGPD). Compacte com senha ou guarde em disco/armazenamento criptografado, **fora do repositório** (o `.gitignore` já bloqueia `*.dump`, `backups/`). Não envie por e-mail/WhatsApp sem proteção. Mantenha as últimas 3 cópias e apague as mais antigas.
3. **Testar:** ao menos uma vez, restaure um backup em um projeto de DEV para confirmar que funciona.

## Supabase gratuito: pausa por inatividade
Projetos gratuitos pausam após cerca de uma semana sem atividade. Durante o piloto a reativação é **manual** (painel → Restore). Se a página pública mostrar erro de conexão, verifique isso primeiro; os dados não se perdem. Se o uso crescer ou houver outros negócios, reavaliar plano pago.

## Hospedagem
Vercel Hobby é para uso pessoal/não comercial. Como o sistema atende um negócio real, confirme nos termos da Vercel se o enquadramento é aceitável antes de publicar; caso contrário, use outro host estático ou plano adequado.

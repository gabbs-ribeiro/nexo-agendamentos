# Nexo Agendamentos (Nexo Labs)

Sistema de agendamento multi-negócio. MVP: banho e tosa de pets. Stack: React + Vite, Supabase (Postgres + Auth), Vercel.

> **Status atual:** o responsável informa que as migrations até `20261021000002_admin_control_catalog.sql` foram executadas no projeto Supabase de DEV. A definição instalada de `get_public_business` foi inspecionada e está sem `contact_phone`, causando falha no teste 01. A migration corretiva `20261021000003_restore_public_business_contact.sql` foi adicionada ao repositório e ainda precisa ser aplicada no DEV; depois, repetir os testes 01–04 e 08–09. URL e chave pública anon estão na Vercel; o usuário responsável foi criado manualmente no Supabase Auth.

## Estrutura
```
src/                   # front React (agendamento público, login e painel de agenda e controle)
tests-front/           # testes Node do front (npm test)
supabase/migrations/   # SQL versionado (migrations novas precisam ser aplicadas em DEV)
supabase/tests/        # testes de isolamento, regras, admin, auditoria e concorrência
supabase/seed/         # provisionamento manual de negócio (modelo, sem dados reais)
docs/                  # HANDOFF_COPILOT.md, TESTES.md
.github/copilot-instructions.md
.env.example
```

## Supabase: estado e configuração
- O responsável informa que as migrations até `20261021000002_admin_control_catalog.sql` foram executadas no DEV. A definição instalada de `get_public_business` estava sem `contact_phone`; a migration corretiva `20261021000003_restore_public_business_contact.sql` precisa ser aplicada manualmente em DEV.
- Após aplicar a migration corretiva, rode novamente os testes 01–04 e 08–09 em DEV; a primeira consulta do teste 04 deve retornar zero linhas.
- O usuário responsável já foi criado manualmente no Supabase Auth; não há cadastro público no aplicativo.
- A URL do projeto e a chave pública anon já foram configuradas nas variáveis de ambiente da Vercel. Nunca configure `service_role` ou `sb_secret_...` no frontend ou em variáveis `VITE_*`.
- O login está disponível em `/login`. Para liberar o acesso administrativo, a conta também precisa ter vínculo com o negócio em `business_members` (papel `owner`). A interface confere sessão e vínculo; autenticar sozinho não concede acesso.
- O painel contém Início com compromissos e link público copiável/compartilhável, Calendário diário com criação manual via RPC, detalhes e cancelamento. O cabeçalho e a página de agendamento mostram logo e nome do estabelecimento; Nexo Agendamentos aparece discretamente no rodapé. A aba Controle edita nome/foto/cor e o WhatsApp público, além de administrar portes e serviços. Na página pública, o tutor escolhe um serviço e um porte por reserva; preço e duração acompanham a opção, e cada pet/serviço adicional exige outro horário.
- Os detalhes internos da configuração e as pendências de validação estão em `docs/HANDOFF_COPILOT.md` e `docs/TESTES.md`.

## Front: rodar localmente
`cp .env.example .env.local` (preencher com URL e chave **anon** do projeto de DEV) → `npm install` → `npm run dev`. Testes do front: `npm test`. Build: `npm run build`. Páginas: `/<slug>` (cliente), `/login` e `/admin` (responsável). A chave `service_role` nunca entra no frontend.

## Backup manual mensal (decisão D15)
O plano gratuito não deve ser tratado como garantia de backup. Uma vez por mês (e antes de qualquer migration em produção):
1. **Exportar:** no painel do Supabase, Table Editor → exportar CSV de `bookings`, `services`, `service_options`, `business_hours`, `time_blocks`, `businesses` **ou**, na sua máquina, `pg_dump "$DATABASE_URL" --no-owner -Fc -f nexo-AAAA-MM.dump` (a `DATABASE_URL` com senha fica só no seu computador, nunca no Git/Vercel).
2. **Guardar com segurança:** os arquivos têm telefones e nomes de clientes (dados pessoais, LGPD). Compacte com senha ou guarde em disco/armazenamento criptografado, **fora do repositório** (o `.gitignore` já bloqueia `*.dump`, `backups/`). Não envie por e-mail/WhatsApp sem proteção. Mantenha as últimas 3 cópias e apague as mais antigas.
3. **Testar:** ao menos uma vez, restaure um backup em um projeto de DEV para confirmar que funciona.

## Supabase gratuito: pausa por inatividade
Projetos gratuitos pausam após cerca de uma semana sem atividade. Durante o piloto a reativação é **manual** (painel → Restore). Se a página pública mostrar erro de conexão, verifique isso primeiro; os dados não se perdem. Se o uso crescer ou houver outros negócios, reavaliar plano pago.

## Hospedagem
Vercel Hobby é para uso pessoal/não comercial. Como o sistema atende um negócio real, confirme nos termos da Vercel se o enquadramento é aceitável antes de publicar; caso contrário, use outro host estático ou plano adequado.

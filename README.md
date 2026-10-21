# Nexo Agendamentos (Nexo Labs)

Sistema de agendamento multi-negócio. MVP: banho e tosa de pets. Stack: React + Vite, Supabase (Postgres + Auth), Vercel.

> **Status:** banco escrito, **não executado nem validado**. Front: fluxo público de reserva escrito e verificado só em Node (sem build nem navegador); painel administrativo ainda não criado. Comece por `docs/HANDOFF_COPILOT.md` e `docs/TESTES.md`.

## Estrutura
```
src/                   # front React (fluxo público de reserva; painel admin ainda nao)
tests-front/           # testes Node da logica pura  (npm test)
supabase/migrations/   # SQL versionado (aplicar em ordem)
supabase/tests/        # testes de isolamento, regras, admin, auditoria e concorrência
supabase/seed/         # provisionamento manual de negócio (modelo, sem dados reais)
docs/                  # HANDOFF_COPILOT.md, TESTES.md
.github/copilot-instructions.md
.env.example
```

## Banco: ordem de execução (projeto de DEV primeiro)
1. Migrations `20261020000001` … `20261020000007` (SQL Editor, ou `supabase db push` se usar o CLI).
2. Testes `01` → `04` (ver `docs/TESTES.md`), depois `05` + `concurrency_test.sh` + `06` + `07`.
3. Só então produção: criar usuário no Auth (signup desligado) e rodar `supabase/seed/provision_business.sql` preenchido.

## Front: rodar localmente
`cp .env.example .env.local` (preencher com URL e chave **anon** do projeto de DEV) → `npm install` → `npm run dev`. Testes: `npm test`. Páginas: `/<slug>` (cliente). A chave `service_role` nunca entra aqui.

## Backup manual mensal (decisão D15)
O plano gratuito não deve ser tratado como garantia de backup. Uma vez por mês (e antes de qualquer migration em produção):
1. **Exportar:** no painel do Supabase, Table Editor → exportar CSV de `bookings`, `services`, `service_options`, `business_hours`, `time_blocks`, `businesses` **ou**, na sua máquina, `pg_dump "$DATABASE_URL" --no-owner -Fc -f nexo-AAAA-MM.dump` (a `DATABASE_URL` com senha fica só no seu computador, nunca no Git/Vercel).
2. **Guardar com segurança:** os arquivos têm telefones e nomes de clientes (dados pessoais, LGPD). Compacte com senha ou guarde em disco/armazenamento criptografado, **fora do repositório** (o `.gitignore` já bloqueia `*.dump`, `backups/`). Não envie por e-mail/WhatsApp sem proteção. Mantenha as últimas 3 cópias e apague as mais antigas.
3. **Testar:** ao menos uma vez, restaure um backup em um projeto de DEV para confirmar que funciona.

## Supabase gratuito: pausa por inatividade
Projetos gratuitos pausam após cerca de uma semana sem atividade. Durante o piloto a reativação é **manual** (painel → Restore). Se a página pública mostrar erro de conexão, verifique isso primeiro; os dados não se perdem. Se o uso crescer ou houver outros negócios, reavaliar plano pago.

## Hospedagem
Vercel Hobby é para uso pessoal/não comercial. Como o sistema atende um negócio real, confirme nos termos da Vercel se o enquadramento é aceitável antes de publicar; caso contrário, use outro host estático ou plano adequado.

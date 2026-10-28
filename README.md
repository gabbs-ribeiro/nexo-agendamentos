# Nexo Agendamentos (Nexo Labs)

Sistema de agendamento multi-negócio. MVP: banho e tosa de pets. Stack: React + Vite, Supabase (Postgres + Auth), Vercel.

> **Status atual:** as migrations são aplicadas manualmente no DEV via SQL Editor. O responsável aplicou as migrations 06 e 07; o teste 09 avançou, mas revelou que `get_available_slots` ainda oferece horários para um porte desativado. Aplique `20261021000008_restore_active_size_slot_filter.sql` somente em DEV e repita o teste 09. As migrations de categorias/expediente também precisam ser validadas conforme o schema instalado. URL e chave pública anon estão na Vercel; o usuário responsável foi criado manualmente no Supabase Auth.

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
- O responsável informa que as migrations anteriores foram executadas no DEV e compartilhou uma atualização de `get_public_business` para incluir `contact_phone`; confirme o resultado do teste 01 após a correção.
- A migration `20261021000004_service_categories.sql` adiciona categorias editáveis por negócio. Aplique-a somente em DEV e rode os testes SQL 01, 04 e 09; a primeira consulta do teste 04 deve retornar zero linhas.
- A migration `20261021000005_admin_business_hours.sql` adiciona salvamento atômico do expediente, com vários períodos por dia. Depois de aplicar, rode também `supabase/tests/10_business_hours_and_day_off.sql`; não execute SQL em produção.
- A migration `20261021000006_restore_booking_size_label.sql` corrige a função de reserva quando o ambiente já possui `business_sizes` e `bookings.size_label`, mas a definição instalada de `app_private.create_booking` está desatualizada. Aplique somente após conferir esses pré-requisitos no DEV e rode novamente o teste 09.
- A migration `20261021000007_restore_public_service_catalog.sql` corrige a resposta pública de serviços para incluir descrição e rótulo atual do porte. Aplique somente no DEV e repita `supabase/tests/09_business_control_catalog.sql`.
- A migration `20261021000008_restore_active_size_slot_filter.sql` restaura na RPC pública `get_available_slots` a validação de porte ativo, serviço ativo e opção ativa. Aplique somente no DEV e repita o teste 09; ele também confirma que o banco rejeita uma reserva para porte desativado.
- A migration `20261022000001_service_booking_mode.sql` adiciona o modo de agendamento do serviço (por horário ou por diária) editável na aba Controle. Aplique-a somente em DEV e rode os testes SQL 11, 04 e 09. A migration `20261022000002_pet_hotel_stays.sql` cria a hospedagem por diária (pet hotel), independente da agenda de horários e com capacidade de 4 pets por vez; rode também o teste SQL 12.
- O usuário responsável já foi criado manualmente no Supabase Auth; não há cadastro público no aplicativo.
- A URL do projeto e a chave pública anon já foram configuradas nas variáveis de ambiente da Vercel. Nunca configure `service_role` ou `sb_secret_...` no frontend ou em variáveis `VITE_*`.
- O login está disponível em `/login`. Para liberar o acesso administrativo, a conta também precisa ter vínculo com o negócio em `business_members` (papel `owner`). A interface confere sessão e vínculo; autenticar sozinho não concede acesso.
- O painel contém Início com compromissos e link público copiável/compartilhável, Calendário diário com criação manual, marcação de folga via RPC, detalhes, cancelamento e conclusão de agendamentos. Agendamentos concluídos permanecem visíveis com identificação diferente. O cabeçalho e a página de agendamento mostram logo e nome do estabelecimento; Nexo Agendamentos aparece discretamente no rodapé. A aba Controle edita perfil, WhatsApp, expediente (vários períodos por dia), portes, categorias e serviços. A página pública agrupa serviços em categorias editáveis; o tutor escolhe um serviço e um porte por reserva, e cada pet/serviço adicional exige outro horário.
- Os detalhes internos da configuração e as pendências de validação estão em `docs/HANDOFF_COPILOT.md` e `docs/TESTES.md`.

## Front: rodar localmente
`cp .env.example .env.local` (preencher com URL e chave **anon** do projeto de DEV) → `npm install` → `npm run dev`. Testes do front: `npm test`. Build: `npm run build`. Páginas: `/<slug>` (cliente), `/login` e `/admin` (responsável). As migrations de categorias e expediente devem estar aplicadas no DEV antes de testar a interface atualizada. A chave `service_role` nunca entra no frontend.

## Backup manual mensal (decisão D15)
O plano gratuito não deve ser tratado como garantia de backup. Uma vez por mês (e antes de qualquer migration em produção):
1. **Exportar:** no painel do Supabase, Table Editor → exportar CSV de `bookings`, `services`, `service_options`, `business_hours`, `time_blocks`, `businesses` **ou**, na sua máquina, `pg_dump "$DATABASE_URL" --no-owner -Fc -f nexo-AAAA-MM.dump` (a `DATABASE_URL` com senha fica só no seu computador, nunca no Git/Vercel).
2. **Guardar com segurança:** os arquivos têm telefones e nomes de clientes (dados pessoais, LGPD). Compacte com senha ou guarde em disco/armazenamento criptografado, **fora do repositório** (o `.gitignore` já bloqueia `*.dump`, `backups/`). Não envie por e-mail/WhatsApp sem proteção. Mantenha as últimas 3 cópias e apague as mais antigas.
3. **Testar:** ao menos uma vez, restaure um backup em um projeto de DEV para confirmar que funciona.

## Supabase gratuito: pausa por inatividade
Projetos gratuitos pausam após cerca de uma semana sem atividade. Durante o piloto a reativação é **manual** (painel → Restore). Se a página pública mostrar erro de conexão, verifique isso primeiro; os dados não se perdem. Se o uso crescer ou houver outros negócios, reavaliar plano pago.

## Hospedagem
Vercel Hobby é para uso pessoal/não comercial. Como o sistema atende um negócio real, confirme nos termos da Vercel se o enquadramento é aceitável antes de publicar; caso contrário, use outro host estático ou plano adequado.
- A migration `20261024000001_transport_delivery.sql` cria o leva e traz (frete por reserva, com km informado manualmente). Aplique somente em DEV e rode os testes SQL 15 e 04.

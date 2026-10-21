# Nexo Agendamentos — Transferência para o GitHub Copilot

> Estado: **banco escrito, NÃO executado, NÃO validado.** Nenhum SQL deste repositório foi rodado em um Postgres/Supabase até aqui. O primeiro trabalho é executar as migrations no projeto de **DEV** e passar todos os testes de `supabase/tests/` (ver `docs/TESTES.md`).
> **Front (itens 1 e 5): fluxo público de reserva escrito**, com testes puros e renderização verificados em Node, mas **`npm install`, `vite build` e o navegador real ainda não foram exercitados** (ver §10).

## 1. O que é
Sistema de agendamento multi-negócio (Nexo Labs). Primeiro cliente: banho e tosa de pets de uma pessoa (uso acadêmico, sem fins lucrativos). Reutilizável por outros negócios no futuro.

## 2. Stack e responsabilidades
| Peça | Papel |
|---|---|
| React + Vite (JavaScript) | Interface pública e painel. **Nenhuma regra de segurança ou de agenda no front.** |
| Supabase Auth | Login dos responsáveis. Cadastro livre **desativado**. |
| Postgres (Supabase) | Fonte da verdade: RLS, constraints, funções RPC, cálculo de horários, concorrência. |
| Vercel (Hobby) | Hospedagem estática do front + rewrite SPA. |
| GitHub | Código e migrations versionadas. |

Nada além disso sem justificar. `service_role` **nunca** no front nem em variável `VITE_*`.

## 3. Decisões aprovadas (não reabrir)
- D1: sem hospedagem de pets no MVP; só serviços com duração (Banho, Banho + Tosa). D2: um atendimento por vez por negócio.
- D3: dados de cliente/pet gravados dentro de `bookings` (sem tabelas `customers`/`pets`). D4: vínculo via `business_members`. D5: negócios criados manualmente (`supabase/seed/provision_business.sql`).
- D6: anti-abuso só com limites no banco no piloto (máx. 2 agendamentos futuros por telefone); CAPTCHA antes de abrir ao público. D9: bloqueio sobre agendamento existente é **rejeitado**. D10: JavaScript.
- D11: cada serviço tem portes (pequeno/médio/grande) marcáveis, cada um com **preço e duração próprios** (`service_options`).
- D12/D13: gap entre atendimentos **10 min**, grade **30 min**, antecedência mínima **2 h**, máxima **30 dias** — todos **editáveis por negócio** (`/admin/configuracoes`). A grade define só os **inícios**; a duração real do serviço nunca é arredondada.
- D14: o serviço **deve terminar até o fechamento** (padrão). `allow_end_after_close` (por negócio, padrão `false`) permite terminar depois, mas **nunca iniciar** depois do fechamento. O **gap** ocupa a agenda após o serviço, pode passar do fechamento e só conflita com outros agendamentos (não com bloqueios).
- D15: exportação manual mensal de dados (ver README). Plano gratuito do Supabase com reativação manual se pausar; reavaliar se o uso crescer.

## 4. Banco (supabase/migrations, aplicar em ordem)
`20261020000001_schema` → `…02_internal_functions` → `…03_public_functions` → `…04_admin_functions` → `…05_rls_and_grants` → `…06_storage_logos` → `…07_business_contact` (telefone/WhatsApp do estabelecimento, para o cliente remarcar/cancelar).

- Tabelas: `businesses`, `business_members`, `services`, `service_options`, `business_hours` (minutos desde 00:00, 0=domingo, várias faixas/dia), `time_blocks`, `bookings`.
- `app_private.compute_slots` é a **única** fonte de “horário livre”; listagem pública e validação da reserva usam a mesma função.
- Sobreposição: *exclusion constraint* (`business_id` + `tstzrange(starts_at, occupied_ends_at)` onde `status <> 'cancelled'`) **e** advisory lock por negócio nas funções que escrevem (cobre bloqueios, que ficam em outra tabela).
- Escrita em `bookings`/`time_blocks` (criar) **somente por funções**. `anon` não tem acesso a nenhuma tabela.

## 5. Contrato das funções (usar via `supabase.rpc`, nunca SQL direto)
Datas (`p_date`) = `YYYY-MM-DD` **no fuso do negócio** (vem em `timezone` de `get_public_business`). Horários (`p_starts_at`) = o ISO `starts_at` devolvido por `get_available_slots`, sem recalcular.

**Públicas (anon):**
- `get_public_business(p_slug)` → `{slug,name,logo_path,primary_color,timezone,max_days_ahead,contact_phone}` ou `null` (`contact_phone` = 10–11 dígitos ou `null`).
- `list_public_services(p_slug)` → `[{service_id,name,options:[{option_id,size,price_cents,duration_minutes}]}]`.
- `get_available_slots(p_slug,p_option_id,p_date)` → linhas `{starts_at,local_time:"HH:MM"}`. Exibir `local_time`.
- `create_public_booking(p_slug,p_option_id,p_starts_at,p_customer_name,p_customer_phone,p_pet_name,p_pet_breed,p_notes,p_consent,p_idempotency_key)` → `{ok:true,booking_ref,service_name,size,starts_at,ends_at,price_cents,timezone}` ou `{ok:false,error}`. **Gerar `p_idempotency_key` (UUID) uma vez por tentativa de confirmação e reutilizá-lo em retries.** `p_consent` = checkbox do aviso de privacidade.

**Admin (authenticated):** `admin_create_booking`, `admin_set_booking_status(id,status)`, `admin_reschedule_booking(id,new_start)`, `admin_update_booking_details`, `admin_create_time_block`. Retornam `{ok:true,...}`/`{ok:false,error}`; `FORBIDDEN` vem como erro HTTP.
Leituras e configuração do painel usam as tabelas diretamente (RLS): `businesses` (colunas liberadas), `services`, `service_options`, `business_hours`, `time_blocks` (ler/apagar), `bookings` (ler).

**Códigos de erro → mensagem sugerida (pt-BR, sem detalhes internos):**
`SLOT_UNAVAILABLE` "Esse horário acabou de ser ocupado. Escolha outro." · `SERVICE_UNAVAILABLE` "Serviço indisponível." · `LIMIT_REACHED` "Limite de agendamentos para este telefone. Fale com o estabelecimento." · `CONSENT_REQUIRED` "Aceite o aviso de privacidade." · `INVALID_INPUT` "Confira os dados informados." · `NOT_FOUND` "Página não encontrada." · `BOOKING_CONFLICT` "Há agendamento nesse período. Cancele-o antes." · `INVALID_TRANSITION` "Essa mudança de status não é permitida." · `INTERNAL_ERROR` "Não foi possível concluir. Tente novamente."

## 6. Front: estrutura sugerida
```
src/
  main.jsx  App.jsx  routes.jsx
  lib/{supabase.js,format.js,errors.js}     # cliente (só chave anon), Intl BRL/data no fuso do negócio, mapa de erros
  components/                                # UI básica reutilizável
  features/
    auth/  agenda/  services/  hours/  blocks/  settings/  public-booking/
vercel.json                                  # rewrite de todas as rotas para /index.html
```
Rotas públicas: `/:slug` · `/:slug/agendar` · `/:slug/confirmado`. Admin: `/login` · `/admin` · `/admin/servicos` · `/admin/horarios` · `/admin/bloqueios` · `/admin/configuracoes`. Slugs `admin`, `login`, `api`… são reservados no banco.

## 7. Variáveis de ambiente (sem valores reais no Git)
| Variável | Onde | Observação |
|---|---|---|
| `VITE_SUPABASE_URL` | front (Vercel/.env.local) | URL do projeto |
| `VITE_SUPABASE_ANON_KEY` | front | chave anon/publishable (pública por desenho; a proteção é RLS+funções) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | só testes locais (`concurrency_test.sh`) | apontar **somente ao DEV** |
| `DATABASE_URL` | só máquina local, para backup (`pg_dump`) | contém senha; nunca commitar |
Usar projetos separados para DEV e produção (as duas vagas gratuitas).

## 8. Pendências (ordem recomendada)
> Itens **1 e 5 já têm primeira versão** (ver §10): falta rodar no navegador contra o DEV.
0. **Executar as migrations no DEV e passar os testes 01–07** (ver `docs/TESTES.md`); corrigir o que falhar *antes* de qualquer front. Desligar signup no Auth; conferir que `app_private` não está em “Exposed schemas”; confirmar bucket de logos.
1. Scaffold Vite + React + React Router + `@supabase/supabase-js`; `vercel.json` com rewrite.
2. Login/logout e guarda de rotas admin (descobrir o negócio via `business_members`).
3. Configurações do negócio (nome, cor, gap, grade, antecedências, `allow_end_after_close`).
4. Serviços com portes (preço em centavos ↔ reais; arquivar em vez de apagar), horários de funcionamento (várias faixas/dia), bloqueios.
5. Fluxo público de reserva (serviço → porte → data → horário → dados + consentimento → confirmação), com tratamento dos códigos de erro e `p_idempotency_key`.
6. Agenda administrativa (ver, criar manual, remarcar, cancelar, concluir/faltou, editar dados).
7. Logo (upload em `business-logos/<business_id>/logo.<ext>`, atualizar `businesses.logo_path`).
8. Endurecimento: aviso de privacidade/LGPD, CAPTCHA (D6) antes de abrir ao público, revisão de mensagens de erro, rotina de backup.
9. Piloto com o negócio real.

## 9. Limitações conhecidas (honestas)
- `contact_phone` só pode ser definido por SQL até existir a tela `/admin/configuracoes` (item 3 da lista).
- Nada foi executado; DST/fusos com horário de verão não foram exercitados (Brasil atual não tem DST).
- Sem limite de taxa nas funções públicas (CAPTCHA/WAF só na pendência 8). `get_available_slots` pode ser chamada em volume.
- Administrador pode agendar fora da antecedência mínima/máxima, mas **não** fora do expediente/grade nem no passado.
- Cliente não cancela nem remarca sozinho (fora do MVP).
- `006_storage_logos.sql` depende do schema `storage` do Supabase e só pode ser validado lá.
- Vercel Hobby é para uso não comercial: confirmar se o uso pelo negócio da prima se enquadra; se não, migrar de hospedagem ou plano.

## 10. Front: estado atual (itens 1 e 5 da ordem recomendada)
**Arquivos:** `package.json`, `vite.config.js`, `vercel.json`, `index.html`; `src/lib/{supabase,api,errors,format}.js`; `src/styles/global.css`; `src/components/Notice.jsx`; `src/features/public-booking/` (`PublicLayout`, `ServicesPage`, `BookingPage` + `StepService/StepDateTime/StepDetails/SummaryBar`, `ConfirmedPage`, `PrivacyPage`, `bookingReducer.js`, `validation.js`).

**Decisões de implementação (manter):**
- `lib/supabase.js` **recusa** `service_role` e `sb_secret_…` no front (lança erro na carga).
- Toda chamada passa por `lib/api.js`: erro de rede vira `ApiError('NETWORK')`; erro de negócio `{ok:false,error}` vira `ApiError(código)`; a tela mostra só mensagens de `lib/errors.js`.
- Datas no **fuso do negócio** (`lib/format.js`); o horário enviado é o `starts_at` exato devolvido pelo banco; exibe-se `local_time`.
- `p_idempotency_key` nasce ao escolher o horário (`bookingReducer`), é reutilizada em retries de rede e renovada se o horário mudar. `SLOT_UNAVAILABLE` volta ao passo de horário preservando servico, data e dados digitados.
- A confirmação guarda em `sessionStorage` **só a resposta do servidor** (sem nome/telefone).
- A cor do negócio só preenche botões/seleções; a cor do texto sobre ela é calculada (contraste). Fonte do sistema (`ui-rounded`), sem requisição externa.

**Verificado (em Node, sem navegador):** `npm test` → 19 testes (formatação, fuso, telefone, contraste, idempotência, reducer, validação), também sob `TZ=UTC`, `Asia/Tokyo` e `America/Los_Angeles`; sintaxe de todos os `.jsx`; renderização no servidor das telas com dados de exemplo (textos, links, HTML escapado, botões desabilitados).
**NÃO verificado:** `npm install`/`vite build`; navegador real e layout visual no celular; integração com o Supabase de DEV; acessibilidade manual (teclado/leitor de tela); comportamento do botão Voltar do navegador (hoje sai do fluxo, não volta ao passo anterior).

**Próximo:** rodar `npm install && npm run dev` com `.env.local` do DEV, criar o negócio de teste (`provision_business.sql`, cadastrar portes) e percorrer o checklist de `docs/TESTES.md` (seção Front). Depois, item 2 (login e guarda de rotas) e item 3 (configurações do negócio, incluindo o telefone de contato).

# Nexo Agendamentos — Transferência para o GitHub Copilot

> Estado: migrations são executadas manualmente no DEV via SQL Editor. O responsável aplicou as migrations 06 e 07; o teste 09 passou pelas verificações anteriores, mas falhou porque `get_available_slots` ainda retornou horários para um porte desativado. A migration corretiva `20261021000008_restore_active_size_slot_filter.sql` restaura a validação de porte ativo; aplicar somente em DEV e repetir o teste 09. O schema `supabase_migrations.schema_migrations` não existe nesse projeto.
> **Front:** agendamento público, login, agenda, detalhes/cancelamento/conclusão, Controle de catálogo categorizado e ajustes mobile implementados localmente. A conclusão usa o status/RPC já existentes no banco; testes frontend/build foram executados nesta entrega. A migration de categorias e a integração com DEV ainda não foram validadas.

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
`20261020000001_schema` → `…02_internal_functions` → `…03_public_functions` → `…04_admin_functions` → `…05_rls_and_grants` → `…06_storage_logos` → `…07_business_contact` → `20261021000001_booking_internal_notes` (anotações internas e preservação do gap histórico em remarcações) → `20261021000002_admin_control_catalog` (perfil público, descrições, portes e snapshot `size_label`) → `20261021000003_restore_public_business_contact` (restaura `contact_phone` na resposta pública de `get_public_business`) → `20261021000004_service_categories` (categorias por negócio e apresentação pública agrupada) → `20261021000005_admin_business_hours` (salvamento atômico do expediente pelo admin) → `20261021000006_restore_booking_size_label` (corrige o snapshot na função de criação de reserva) → `20261021000007_restore_public_service_catalog` (restaura descrição e rótulo atual do porte no catálogo público) → `20261021000008_restore_active_size_slot_filter` (restaura o filtro de porte ativo em `get_available_slots`).

- Tabelas: `businesses`, `business_members`, `services`, `service_options`, `business_hours` (minutos desde 00:00, 0=domingo, várias faixas/dia), `time_blocks`, `bookings`.
- `app_private.compute_slots` é a **única** fonte de “horário livre”; listagem pública e validação da reserva usam a mesma função.
- Sobreposição: *exclusion constraint* (`business_id` + `tstzrange(starts_at, occupied_ends_at)` onde `status <> 'cancelled'`) **e** advisory lock por negócio nas funções que escrevem (cobre bloqueios, que ficam em outra tabela).
- Escrita em `bookings`/`time_blocks` (criar) **somente por funções**. `anon` não tem acesso a nenhuma tabela.
- `bookings` mantém snapshots de serviço, porte, preço, duração, horários e gap. Alterar/arquivar um serviço não reescreve esses valores; remarcação muda só os instantes e mantém a duração e o gap original.
- `business_sizes` guarda um catálogo de portes por estabelecimento; cada opção de serviço referencia um porte ativo. `bookings.size_label` preserva o rótulo do porte que foi contratado, mesmo se o catálogo for renomeado.
- `service_categories` guarda categorias editáveis por estabelecimento. `services.category_id` referencia uma categoria do mesmo negócio; renomear ou mover serviços não altera snapshots históricos. As categorias iniciais são “Banho e tosa” e “Pet Hotel / creche”.
- Notas internas ficam em `bookings.internal_notes`, separadas de `notes` (informação enviada pelo tutor), e só podem ser alteradas pela RPC `admin_update_booking_internal_notes`.

## 5. Contrato das funções (usar via `supabase.rpc`, nunca SQL direto)
Datas (`p_date`) = `YYYY-MM-DD` **no fuso do negócio** (vem em `timezone` de `get_public_business`). Horários (`p_starts_at`) = o ISO `starts_at` devolvido por `get_available_slots`, sem recalcular.

**Públicas (anon):**
- `get_public_business(p_slug)` → `{slug,name,logo_path,primary_color,timezone,max_days_ahead,contact_phone}` ou `null` (`contact_phone` = 10–11 dígitos ou `null`).
- `list_public_services(p_slug)` → `[{service_id,name,description,options:[{option_id,size,size_label,price_cents,duration_minutes}]}]`.
- `list_public_service_categories(p_slug)` → categorias públicas com nome, descrição e serviços ativos/opções disponíveis; inclui categorias vazias, sem expor acesso direto às tabelas.
- `get_available_slots(p_slug,p_option_id,p_date)` → linhas `{starts_at,local_time:"HH:MM"}`. Exibir `local_time`.
- `create_public_booking(p_slug,p_option_id,p_starts_at,p_customer_name,p_customer_phone,p_pet_name,p_pet_breed,p_notes,p_consent,p_idempotency_key)` → `{ok:true,booking_ref,service_name,size,size_label,starts_at,ends_at,price_cents,timezone}` ou `{ok:false,error}`. **Gerar `p_idempotency_key` (UUID) uma vez por tentativa de confirmação e reutilizá-lo em retries.** `p_consent` = checkbox do aviso de privacidade.

**Admin (authenticated):** `admin_create_booking`, `admin_set_booking_status(id,status)`, `admin_reschedule_booking(id,new_start)`, `admin_update_booking_details`, `admin_create_time_block`. Retornam `{ok:true,...}`/`{ok:false,error}`; `FORBIDDEN` vem como erro HTTP.
Nova RPC na migration `20261021000001`: `admin_update_booking_internal_notes(booking_id, internal_notes)`, com autorização por `business_members`. `admin_set_booking_status(id,'cancelled')` é o caminho de cancelamento; mantém a linha e não permite reativar um registro cancelado.
Nova RPC na migration `20261021000005`: `admin_replace_business_hours(p_business_id,p_hours)` valida e troca atomicamente todas as faixas semanais do estabelecimento, incluindo múltiplas faixas no mesmo dia; somente `authenticated` pode executá-la e a função exige vínculo no negócio. Dias de folga usam `admin_create_time_block` para bloquear o dia inteiro no fuso do negócio; a RPC rejeita conflitos. Remover uma folga usa a exclusão RLS de `time_blocks`.
Leituras e configuração do painel usam tabelas sob RLS e grants mínimos: `businesses`, `business_sizes`, `service_categories`, `services`, `service_options`, `business_hours`, `time_blocks` (ler/apagar), `bookings` (ler). Serviços são arquivados em vez de excluídos; categorias e portes não são excluídos para preservar associações e referências históricas.

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
Rotas públicas: `/:slug` · `/:slug/agendar` · `/:slug/confirmado`. Admin: `/login` · `/admin` · `/admin/calendario` · `/admin/controle`. Slugs `admin`, `login`, `api`… são reservados no banco.

## 7. Variáveis de ambiente (sem valores reais no Git)
| Variável | Onde | Observação |
|---|---|---|
| `VITE_SUPABASE_URL` | front (Vercel/.env.local) | URL do projeto |
| `VITE_SUPABASE_ANON_KEY` | front | chave anon/publishable (pública por desenho; a proteção é RLS+funções) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | só testes locais (`concurrency_test.sh`) | apontar **somente ao DEV** |
| `DATABASE_URL` | só máquina local, para backup (`pg_dump`) | contém senha; nunca commitar |
Usar projetos separados para DEV e produção (as duas vagas gratuitas).

## 8. Pendências (ordem recomendada)
> O responsável informa que as migrations anteriores foram executadas em DEV e compartilhou atualização para incluir `contact_phone` em `get_public_business`.
0. Aplicar `20261021000004_service_categories.sql` somente no DEV; depois rodar `supabase/tests/01`, `04` e `09`; confirmar que a primeira consulta de 04 retorna zero linhas. Repetir os testes 01–04 e 08–09 se a correção `contact_phone` ainda não tiver sido validada.
1. Scaffold Vite + React + React Router + `@supabase/supabase-js`; `vercel.json` com rewrite.
2. Login/logout e guarda de rotas admin por `business_members` — primeira versão implementada; validar no navegador contra o DEV.
3. Configurações do negócio (nome, cor e foto do perfil foram iniciados na aba Controle; gap, grade, antecedências e `allow_end_after_close` continuam pendentes).
4. Serviços, categorias editáveis, catálogo de portes com preço/duração por opção e arquivamento foram iniciados na aba Controle. A interface de horários de funcionamento (várias faixas/dia) e a ação de marcar/remover folga no Calendário foram implementadas localmente; falta aplicar e validar a migration 05 e testar a integração em DEV.
5. Fluxo público de reserva (serviço → porte → data → horário → dados + consentimento → confirmação), com tratamento dos códigos de erro e `p_idempotency_key`.
6. Agenda administrativa — início, calendário diário, criação manual, detalhes, edição de dados de tutor/pet, anotações internas, cancelamento e conclusão após o término previsto já têm primeira versão. Remarcar, marcar falta e demais telas do painel ainda pendentes.
7. Logo (upload em `business-logos/<business_id>/logo.<ext>`, atualizar `businesses.logo_path`).
8. Endurecimento: aviso de privacidade/LGPD, CAPTCHA (D6) antes de abrir ao público, revisão de mensagens de erro, rotina de backup.
9. Piloto com o negócio real.

## 9. Limitações conhecidas (honestas)
- Parâmetros de agenda (gap, grade, antecedência e allow_end_after_close) ainda não têm telas de configuração; o WhatsApp de contato pode ser editado na aba Controle.
- As migrations `20261021000004_service_categories.sql`, `20261021000005_admin_business_hours.sql`, `20261021000006_restore_booking_size_label.sql`, `20261021000007_restore_public_service_catalog.sql` e `20261021000008_restore_active_size_slot_filter.sql` precisam ser validadas/aplicadas em DEV conforme o estado real do projeto; não execute SQL em produção. Confirmar também o resultado final do teste 01 após a correção de `contact_phone`.
- No DEV, `app_private.create_booking` foi verificada e a definição não continha `size_label`, causando a falha do teste 09. O catálogo já está acessível, mas o controle de migrations do Supabase não está instalado nesse projeto; migrations executadas manualmente no SQL Editor não ficam registradas automaticamente nesse schema. A migration 06 atualiza somente a função interna e exige que a coluna `bookings.size_label` e a tabela `business_sizes` existam.
- O responsável confirmou a aplicação das migrations 06 e 07. O teste 09 avançou e agora falhou porque `get_available_slots` ainda ofereceu horário após desativar o porte. A migration 08 restaura a RPC com os filtros de porte/serviço/opção ativos e preserva assinatura e grants públicos; o teste 09 também verifica a rejeição de uma nova reserva para o porte desativado.
- A configuração de horários no Controle permite várias faixas por dia e salva o conjunto via RPC atômica. O Calendário marca folga por `admin_create_time_block`; a checagem visual de conflitos é apenas preventiva e o banco revalida a operação. Testes SQL 01, 04 e 10, além da validação manual em DEV, ainda estão pendentes.
- A integração da nova aba Controle contra o Supabase de DEV e a validação manual de upload do logo ainda estão pendentes.
- DST/fusos com horário de verão não foram exercitados (Brasil atual não tem DST).
- Sem limite de taxa nas funções públicas (CAPTCHA/WAF só na pendência 8). `get_available_slots` pode ser chamada em volume.
- Administrador pode agendar fora da antecedência mínima/máxima, mas **não** fora do expediente/grade nem no passado.
- Cliente não cancela nem remarca sozinho (fora do MVP).
- `006_storage_logos.sql` depende do schema `storage` do Supabase e só pode ser validado lá.
- Vercel Hobby é para uso não comercial: confirmar se o uso pelo negócio da prima se enquadra; se não, migrar de hospedagem ou plano.

## 10. Front: estado atual (itens 1, 2, 5, parte do 6 e início do 3/4)
**Arquivos:** `package.json`, `vite.config.js`, `vercel.json`, `index.html`; `src/lib/{supabase,api,errors,format}.js`; `src/styles/global.css`; `src/components/{Notice,ConfirmDialog}.jsx`; `src/features/auth/`; `src/features/admin/` (agenda diária e detalhes); `src/features/public-booking/`.

**Decisões de implementação (manter):**
- `lib/supabase.js` **recusa** `service_role` e `sb_secret_…` no front (lança erro na carga); quando as variáveis públicas não existem, o app informa que falta configuração.
- Toda chamada passa por `lib/api.js`: erro de rede vira `ApiError('NETWORK')`; erro de negócio `{ok:false,error}` vira `ApiError(código)`; a tela mostra só mensagens de `lib/errors.js`.
- Datas no **fuso do negócio** (`lib/format.js`); o horário enviado é o `starts_at` exato devolvido pelo banco; exibe-se `local_time`.
- `p_idempotency_key` nasce ao escolher o horário (`bookingReducer`), é reutilizada em retries de rede e renovada se o horário mudar. `SLOT_UNAVAILABLE` volta ao passo de horário preservando servico, data e dados digitados.
- A confirmação guarda em `sessionStorage` **só a resposta do servidor** (sem nome/telefone).
- A identidade visual usa tons quentes, fundo creme, cartões arredondados e fontes do sistema (sem requisição externa). O contraste de texto sobre a cor pública do negócio é calculado.
- `/login` usa Supabase Auth com e-mail/senha; `/admin/*` verifica sessão e vínculo `owner` em `business_members` sob RLS. Não há cadastro público.
- Início recebe com resumo dos atendimentos do dia, destaca separadamente observações do cliente e anotações internas e oferece cópia/compartilhamento do link público. O Calendário permite escolher data, consultar horários disponíveis, criar agendamentos manuais via `admin_create_booking` e marcar/remover folga para o dia inteiro. A verificação antecipada de agendamentos gera orientação para cancelar compromissos confirmados, mas `admin_create_time_block` é a autoridade final contra conflitos. As anotações internas são salvas pela RPC `admin_update_booking_internal_notes`. Início e Calendário mostram agendamentos confirmados e concluídos, sem cancelados. A conclusão só fica disponível quando passa o término previsto, exige confirmação e chama `admin_set_booking_status(..., 'completed')`; os concluídos permanecem visíveis com estilo/status distintos.
- Cancelamento chama `admin_set_booking_status` somente após confirmação num modal acessível; logout também exige confirmação. Erros mantêm a ação sem sucesso simulado.
- A aba Controle edita perfil público (nome/foto/cor e WhatsApp), horários de funcionamento (dias da semana e múltiplas faixas diárias via RPC atômica), catálogo de portes e categorias editáveis (título/descrição) e gerencia serviços associados a uma categoria (nome/descrição/porte/preço/duração). O editor de serviço abre em uma janela própria; serviços são arquivados e novas opções usam a duração do banco para cálculo da agenda.
- O cabeçalho administrativo e público usa a logo e o nome editáveis do estabelecimento; “Nexo Agendamentos” fica em texto pequeno no rodapé.
- Na página pública, um cartão de boas-vindas antecede categorias editáveis, inicialmente recolhidas em cards com título, descrição e seta. O resumo/carrinho só aparece após selecionar uma opção de porte de um serviço; porte, preço e duração selecionados ficam explícitos em um resumo compacto. O passo de data mantém espaço visual aumentado entre título e dias, e o consentimento de privacidade fica alinhado em linha. Uma reserva é de um serviço/porte e um pet por horário; outro pet/serviço requer outra reserva, conforme o modelo atual do banco. “Pet Hotel / creche” é somente uma categoria do catálogo: o MVP continua usando horários e duração de serviços, sem semântica de hospedagem multi-dia.

**Verificado nesta entrega:** `npm test` → 38 pass, 0 fail; `npm run build` passou usando URL/chave anon placeholder (sem ler nem usar `.env`); `git diff --check` passou. Nenhum SQL foi executado.
**NÃO verificado nesta entrega:** aplicação em DEV da migration 08; execução dos testes SQL atualizados 01, 04, 09 e 10; saída vazia da primeira consulta 04; integração de horários e folgas contra Supabase DEV; acessibilidade manual (teclado/leitor de tela); aparência em aparelhos reais. O responsável confirmou a aplicação das migrations 06 e 07; o teste 09 falhou na validação de porte desativado, e a migration 08 foi preparada sem execução remota.

**Próximo:** aplicar `20261021000008_restore_active_size_slot_filter.sql` somente no DEV; se quiser conferir a definição, use `select pg_get_functiondef('public.get_available_slots(text,uuid,date)'::regprocedure);` e verifique o filtro `business_sizes.is_active`. Repetir `supabase/tests/09_business_control_catalog.sql` e `supabase/tests/04_permission_audit.sql` (a primeira consulta deve retornar 0 linhas). Aplicar/validar também migrations 04 e 05 se pendentes e executar 01 e 10. Migrations já executadas manualmente não aparecem automaticamente em `supabase_migrations.schema_migrations`; não reaplicar migrations não idempotentes sem verificar o schema. Nunca aplicar correções em produção antes desses testes.

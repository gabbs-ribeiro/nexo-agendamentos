# Testes e validação de segurança

**Regra:** escrever política RLS não é validar segurança. Os testes SQL 01–07 foram executados no projeto de DEV, conforme confirmação do responsável pelo projeto. A migration `20261021000001_booking_internal_notes.sql` e o novo teste 08 ainda precisam ser aplicados/executados; rode novamente 01–04 (incluindo a auditoria 04) após essa migration.

## Como rodar (SQL Editor do Supabase DEV, como `postgres`)
1. Aplicar as migrations em ordem (`supabase/migrations/`). Em caso de erro, **pare e corrija a migration**; não improvise no painel.
2. Rodar cada teste abaixo. Os de 01–03 rodam em transação com `ROLLBACK` (não deixam dados). Esperado: mensagens `PASS` e nenhuma exceção (um `ASSERTION FAILED`/`FAIL` indica problema real).
3. Se o `insert into auth.users (id, email)` dos testes falhar por coluna obrigatória na sua versão do Supabase, ajuste só o `INSERT` de preparação (não as asserções).

| # | Arquivo | O que prova | Esperado | Resultado |
|---|---|---|---|---|
| 01 | `tests/01_isolation_and_permissions.sql` | Negócio A não lê/altera/apaga/insere dados de B; usuário sem vínculo vê 0 linhas; `anon` sem acesso a tabelas nem a funções admin/internas; respostas públicas sem dados internos | só PASS | ✅ executado em DEV (confirmação do responsável); repetir após nova migration |
| 02 | `tests/02_booking_rules.sql` | Grade, duração real (45 min), gap, expediente, bloqueios, fuso, antecedência, inativos, idempotência, limite por telefone, constraints do banco | só PASS | ✅ executado em DEV (confirmação do responsável) |
| 03 | `tests/03_admin_functions.sql` | Criar/remarcar/status/editar/bloqueios como admin, mesmas regras de agenda; remarcação preserva gap snapshot | só PASS | ✅ executado antes da alteração; repetir após nova migration |
| 04 | `tests/04_permission_audit.sql` | RLS ligada, grants mínimos, funções executáveis só por quem deve, `search_path` fixo, sem sobreposição de dados | **0 linhas** na 1ª consulta | ✅ executado antes da alteração; repetir após nova migration |
| 05–07 | `tests/05…`, `concurrency_test.sh`, `06…`, `07…` | N requisições simultâneas reais pela API pública: 1 sucesso no mesmo horário, 1 sucesso entre horários conflitantes, idempotência concorrente | script termina com “todos os cenários passaram”; 06: 3 agendamentos, 0 sobreposições | ✅ executados em DEV (confirmação do responsável) |
| 08 | `tests/08_booking_history_and_cancellation.sql` | Novas reservas usam configurações atuais; edição/arquivamento/remarcação preservam snapshots; notas internas e isolamento; cancelamento definitivo libera horário | só PASS | ☐ pendente: requer migration `20261021000001` |

Repita **04** depois de qualquer migration nova e antes de qualquer uso real. Para a migration nova, rode 01–04 e 08 no DEV.

## Concorrência: o que o script cobre e o que não cobre
Coberto: várias reservas simultâneas (mesmo horário, horários conflitantes, mesma chave de idempotência) pela API real.
**Não coberto pelo script — fazer manualmente com duas abas do SQL Editor (DEV, negócio `loja-concorrencia`):**
0. Pré-requisito: vincule um usuário de DEV ao negócio de teste: `insert into public.business_members (user_id, business_id) values ('<UUID_DO_USUARIO_DEV>', 'c0000000-0000-0000-0000-0000000000c1');`
1. Aba 1: `begin; select public.create_public_booking(...);` para um horário livre — **não confirme** (sem `commit`).
2. Aba 2 (como usuário admin do negócio, com `set local role authenticated` + claims, ou pelo app): chamar `admin_create_time_block` cobrindo o mesmo horário. Deve **ficar esperando** (lock).
3. Aba 1: `commit;`. A aba 2 deve concluir com `BOOKING_CONFLICT`. Repita invertendo a ordem (bloqueio primeiro, reserva depois → reserva deve dar `SLOT_UNAVAILABLE`).

## Checklist de configuração (fora do SQL — conferir no painel)
- [ ] Authentication: cadastro livre (signup) **desligado**; senha forte para o usuário do negócio.
- [ ] Settings → API: “Exposed schemas” contém `public`, **não** contém `app_private`.
- [ ] Nenhuma `service_role`/`DATABASE_URL` em código, `.env` versionado ou variável `VITE_*`.
- [ ] Bucket `business-logos`: público, 1 MB, PNG/JPEG/WEBP; envio fora da pasta do próprio negócio falha.
- [ ] Realtime **não** habilitado em `bookings`.
- [ ] Mensagens de erro do front não exibem texto bruto do banco.

## Ainda não testado (fica para o front/piloto)
Fluxo completo com navegador e fuso diferente do negócio; logo/Storage; comportamento do pooler do Supabase sob carga real; limites de e-mail do Auth (recuperação de senha); CAPTCHA.

## Front (agendamento público e painel)
**Automático (Node, sem navegador):** `npm test` → 25 testes de lógica (inclui apresentação com snapshots, cálculo de data no fuso do negócio e elegibilidade para cancelamento). Resultado esperado: `# pass 25`, `# fail 0`.

**Login (manual no navegador, contra o DEV):**
- [ ] `/login` abre o formulário sem consultar um estabelecimento com slug `login`.
- [ ] Credenciais inválidas mostram apenas mensagem amigável, sem texto bruto do Auth.
- [ ] Usuário autenticado sem linha em `business_members` não acessa `/admin` e recebe aviso de falta de vínculo.
- [ ] Usuário com vínculo `owner` acessa Início, Calendário e detalhes de agendamentos; negócios diferentes permanecem isolados.
- [ ] Acessar `/admin` sem sessão redireciona para `/login`; sair só encerra a sessão após confirmar no modal.
- [ ] Signup público permanece desativado; responsáveis são cadastrados manualmente pelo Supabase.
- [ ] Cancelar exige confirmação; “Voltar” e Escape fecham o modal sem alterar o status.
- [ ] Ao confirmar o cancelamento, a linha histórica permanece, o status muda e o horário volta a ficar disponível.
- [ ] A falha da RPC de cancelamento mantém o modal aberto, não mostra sucesso e apresenta mensagem amigável.
- [ ] Detalhes mostram serviço, porte, duração, preço e horários registrados; edição das informações do tutor/pet não altera snapshots.
- [ ] Anotações internas são salvas separadas das observações do tutor e só aparecem para membros do negócio.

**Manual no navegador, contra o DEV** (`npm run dev`, `.env.local` com a URL e a chave anon do DEV; negócio com ao menos 1 serviço e 1 porte):
- [ ] `/<slug>` mostra nome, serviços, preços e duração; slug inexistente mostra "Página não encontrada".
- [ ] Fluxo completo: serviço/porte → dia → horário → dados → confirmar → comprovante com o horário correto.
- [ ] No celular (ou 375 px): botões grandes, nada cortado, barra "Continuar/Confirmar" visível, teclado numérico no telefone.
- [ ] Fuso: com o relógio/fuso do computador diferente de São Paulo, os horários exibidos continuam os do negócio.
- [ ] Dois navegadores no **mesmo horário**: o segundo recebe "Esse horário acabou de ser ocupado", volta à escolha de horário e mantém os dados digitados.
- [ ] Derrubar a internet ao confirmar, religar e tocar de novo em Confirmar: **uma única** reserva no banco.
- [ ] Horário bloqueado, fora do expediente, antes da antecedência mínima e serviço/porte desativado **não aparecem**.
- [ ] Recarregar a página do comprovante mantém o comprovante; abrir `/<slug>/confirmado` em aba nova sem reserva volta ao início.
- [ ] Teclado: tab percorre tudo, foco sempre visível, Enter confirma o formulário; leitor de tela anuncia erros dos campos.
- [ ] Cor da marca clara (ex.: amarelo) e escura: texto dos botões continua legível.
- [ ] Nenhum texto técnico/bruto aparece em erros (desligue o projeto/derrube a rede para ver a mensagem genérica).

# Testes e validação de segurança

**Regra:** escrever política RLS não é validar segurança. O responsável informa que as migrations até `20261021000002_admin_control_catalog.sql` foram executadas em DEV. A função instalada `get_public_business` não retorna a chave `contact_phone`; aplique a migration corretiva `20261021000003_restore_public_business_contact.sql` em DEV antes de repetir os testes. A primeira consulta do teste 04 ainda precisa retornar zero linhas.

## Como rodar (SQL Editor do Supabase DEV, como `postgres`)
1. Aplicar as migrations em ordem (`supabase/migrations/`). Em caso de erro, **pare e corrija a migration**; não improvise no painel.
2. Rodar cada teste abaixo. Os de 01–03 rodam em transação com `ROLLBACK` (não deixam dados). Esperado: mensagens `PASS` e nenhuma exceção (um `ASSERTION FAILED`/`FAIL` indica problema real).
3. Se o `insert into auth.users (id, email)` dos testes falhar por coluna obrigatória na sua versão do Supabase, ajuste só o `INSERT` de preparação (não as asserções).

| # | Arquivo | O que prova | Esperado | Resultado |
|---|---|---|---|---|
| 01 | `tests/01_isolation_and_permissions.sql` | Negócio A não lê/altera/apaga/insere dados de B; usuário sem vínculo vê 0 linhas; `anon` sem acesso a tabelas nem a funções admin/internas; respostas públicas sem dados internos | só PASS | ❌ falhou: resposta sem `contact_phone`; migration corretiva criada, pendente de aplicação e nova execução |
| 02 | `tests/02_booking_rules.sql` | Grade, duração real (45 min), gap, expediente, bloqueios, fuso, antecedência, inativos, idempotência, limite por telefone, constraints do banco | só PASS | ✅ executado em DEV (confirmação do responsável) |
| 03 | `tests/03_admin_functions.sql` | Criar/remarcar/status/editar/bloqueios como admin, mesmas regras de agenda; remarcação preserva gap snapshot | só PASS | ✅ responsável relata execução sem erro após migration 01; repetir após 02 |
| 04 | `tests/04_permission_audit.sql` | RLS ligada, grants mínimos, funções executáveis só por quem deve, `search_path` fixo, sem sobreposição de dados | **0 linhas** na 1ª consulta | ⚠️ executado; confirmar que a primeira consulta retornou 0 linhas |
| 05–07 | `tests/05…`, `concurrency_test.sh`, `06…`, `07…` | N requisições simultâneas reais pela API pública: 1 sucesso no mesmo horário, 1 sucesso entre horários conflitantes, idempotência concorrente | script termina com “todos os cenários passaram”; 06: 3 agendamentos, 0 sobreposições | ✅ executados em DEV (confirmação do responsável) |
| 08 | `tests/08_booking_history_and_cancellation.sql` | Novas reservas usam configurações atuais; edição/arquivamento/remarcação preservam snapshots; notas internas e isolamento; cancelamento definitivo libera horário | só PASS | ✅ responsável relata execução sem erro após migration 01; repetir após 02 |
| 09 | `tests/09_business_control_catalog.sql` | Perfil, serviço com descrição, porte customizado, preço/duração por opção, disponibilidade e snapshot do rótulo | só PASS | ☐ executar/repetir após aplicar a migration corretiva 03 |

Em DEV, aplique `20261021000003_restore_public_business_contact.sql` e rode 01–04 e 08–09. Repita **04** após qualquer migration nova; a primeira consulta deve retornar 0 linhas. Não aplique correções em produção antes da validação.

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
**Automático (Node, sem navegador):** `npm test` → 33 testes, incluindo apresentação histórica, seleção de preço/duração por porte, fusos e montagem segura do link público. Última execução: `# pass 33`, `# fail 0`.

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
- [ ] Na agenda, observações preenchidas pelo cliente e anotações internas aparecem com rótulos e cores diferentes.
- [ ] A aba Controle altera nome/foto/cor públicos; o perfil atualizado aparece na rota `/<slug>`.
- [ ] A aba Controle salva WhatsApp com DDD ou permite deixá-lo vazio; o número correto aparece como contato na página pública.
- [ ] Cabeçalho do painel e da página pública mostram a logo e o nome atualizados do estabelecimento; “Nexo Agendamentos” só aparece em tamanho pequeno no rodapé.
- [ ] Início mostra os compromissos de hoje, texto de agenda vazia e anotações internas em destaque; o link público pode ser copiado e compartilhado.
- [ ] Calendário permite escolher dia, consulta horários pelo banco e cria agendamento manual com serviço, porte, data/horário, dados do tutor/pet e observações via RPC; anotação interna é salva pela RPC separada.
- [ ] Em caso de falha de rede ao criar agendamento manual, a interface avisa para conferir a agenda antes de repetir; falha ao salvar nota não simula sucesso e aponta os detalhes do agendamento.
- [ ] Serviços exibem a descrição no fluxo público; porte, preço e duração configurados alimentam as novas reservas.
- [ ] Renomear ou desativar um porte não altera rótulos e snapshots de agendamentos existentes; porte desativado deixa de oferecer novos horários.

**Manual no navegador, contra o DEV** (`npm run dev`, `.env.local` com a URL e a chave anon do DEV; negócio com ao menos 1 serviço e 1 porte):
- [ ] `/<slug>` mostra nome, serviços, preços e duração; slug inexistente mostra "Página não encontrada".
- [ ] Fluxo completo: serviço/porte → dia → horário → dados → confirmar → comprovante com o horário correto.
- [ ] Cada cartão apresenta o serviço e “A partir de” com o menor preço; selecionar um porte atualiza preço/duração no resumo e inicia uma reserva para um serviço/animal. Para outro serviço ou animal, é necessário reservar outro horário.
- [ ] O comprovante agradece ao cliente, confirma que o serviço foi agendado e oferece contato pelo WhatsApp configurado em Controle.
- [ ] No celular (ou 375 px): botões grandes, nada cortado, barra "Continuar/Confirmar" visível, teclado numérico no telefone.
- [ ] Fuso: com o relógio/fuso do computador diferente de São Paulo, os horários exibidos continuam os do negócio.
- [ ] Dois navegadores no **mesmo horário**: o segundo recebe "Esse horário acabou de ser ocupado", volta à escolha de horário e mantém os dados digitados.
- [ ] Derrubar a internet ao confirmar, religar e tocar de novo em Confirmar: **uma única** reserva no banco.
- [ ] Horário bloqueado, fora do expediente, antes da antecedência mínima e serviço/porte desativado **não aparecem**.
- [ ] Recarregar a página do comprovante mantém o comprovante; abrir `/<slug>/confirmado` em aba nova sem reserva volta ao início.
- [ ] Teclado: tab percorre tudo, foco sempre visível, Enter confirma o formulário; leitor de tela anuncia erros dos campos.
- [ ] Cor da marca clara (ex.: amarelo) e escura: texto dos botões continua legível.
- [ ] Nenhum texto técnico/bruto aparece em erros (desligue o projeto/derrube a rede para ver a mensagem genérica).

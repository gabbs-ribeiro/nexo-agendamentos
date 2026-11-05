# Testes e validação de segurança

**Regra:** escrever política RLS não é validar segurança. O responsável informa que as migrations são executadas manualmente em DEV e compartilhou uma atualização de `get_public_business` para incluir `contact_phone`; confirme o resultado final do teste 01. O responsável aplicou as migrations 06 e 07; o teste 09 agora falha porque `get_available_slots` ainda oferece horários para porte desativado. Aplique `20261021000008_restore_active_size_slot_filter.sql` somente no DEV e repita 09 e 04. As migrations 04 e 05 também precisam ser conferidas/aplicadas conforme o schema instalado, e rode 01 e 10. A primeira consulta do teste 04 deve retornar zero linhas.

## Como rodar (SQL Editor do Supabase DEV, como `postgres`)
1. Aplicar as migrations em ordem (`supabase/migrations/`). Em caso de erro, **pare e corrija a migration**; não improvise no painel.
2. Rodar cada teste abaixo. Os testes transacionais rodam com `ROLLBACK` (não deixam dados). Esperado: mensagens `PASS` e nenhuma exceção (um `ASSERTION FAILED`/`FAIL` indica problema real).
3. Se o `insert into auth.users (id, email)` dos testes falhar por coluna obrigatória na sua versão do Supabase, ajuste só o `INSERT` de preparação (não as asserções).

| # | Arquivo | O que prova | Esperado | Resultado |
|---|---|---|---|---|
| 01 | `tests/01_isolation_and_permissions.sql` | Negócio A não lê/altera/apaga/insere dados de B; usuário sem vínculo vê 0 linhas; `anon` sem acesso a tabelas nem a funções admin/internas; respostas públicas sem dados internos | só PASS | ⚠️ falha anterior por ausência de `contact_phone`; resultado após a correção ainda precisa ser confirmado |
| 02 | `tests/02_booking_rules.sql` | Grade, duração real (45 min), gap, expediente, bloqueios, fuso, antecedência, inativos, idempotência, limite por telefone, constraints do banco | só PASS | ✅ executado em DEV (confirmação do responsável) |
| 03 | `tests/03_admin_functions.sql` | Criar/remarcar/status/editar/bloqueios como admin, mesmas regras de agenda; remarcação preserva gap snapshot | só PASS | ✅ responsável relata execução sem erro após migration 01; repetir após 02 |
| 04 | `tests/04_permission_audit.sql` | RLS ligada, grants mínimos, funções executáveis só por quem deve, `search_path` fixo, sem sobreposição de dados | **0 linhas** na 1ª consulta | ⚠️ executado; confirmar que a primeira consulta retornou 0 linhas |
| 05–07 | `tests/05…`, `concurrency_test.sh`, `06…`, `07…` | N requisições simultâneas reais pela API pública: 1 sucesso no mesmo horário, 1 sucesso entre horários conflitantes, idempotência concorrente | script termina com “todos os cenários passaram”; 06: 3 agendamentos, 0 sobreposições | ✅ executados em DEV (confirmação do responsável) |
| 08 | `tests/08_booking_history_and_cancellation.sql` | Novas reservas usam configurações atuais; edição/arquivamento/remarcação preservam snapshots; notas internas e isolamento; cancelamento definitivo libera horário | só PASS | ✅ responsável relata execução sem erro após migration 01; repetir após 02 |
| 09 | `tests/09_business_control_catalog.sql` | Perfil, categorias, associação e edição, serviço com descrição, porte customizado, preço/duração por opção, disponibilidade e snapshot do rótulo; porte desativado não oferece horários nem aceita reserva | só PASS | ⚠️ migrations 06 e 07 aplicadas; falha atual: porte desativado ainda aparece em `get_available_slots`; aplicar migration corretiva 08 e repetir |
| 10 | `tests/10_business_hours_and_day_off.sql` | Múltiplos períodos por dia, atualização atômica (mantém horários anteriores ao rejeitar sobreposição), conflito de folga com agendamento e bloqueio no fuso do negócio | só PASS | ☐ executar após aplicar a migration 05 |
| 11 | `tests/11_service_booking_mode.sql` | Serviço novo nasce por horário; valor inválido de modo é recusado; catálogo público devolve `booking_mode`; serviço por diária não oferece horários nem aceita reserva (admin e público); serviço por horário segue reservando; `anon` não altera o modo | só PASS | ☐ executar após aplicar a migration `20261022000001` |
| 12 | `tests/12_pet_hotel_stays.sql` | Capacidade 4; 5ª estadia esgota (`STAY_FULL`); noite da saída não conta; idempotência; hotel lotado não bloqueia banho e tosa e folga da agenda não bloqueia hotel; limite por telefone; datas inválidas; snapshot de preço; cancelar libera vaga; sem escrita direta; isolamento entre negócios; anon sem acesso | só PASS | ☐ executar após a migration `20261022000002` |
| 13 | `tests/13_service_booking_models.sql` | Creche por manhã/tarde/integral, capacidade máxima de quatro em cada intervalo, preços por período, idempotência; hospedagem dentro das janelas configuradas, grade de 30 minutos, cobranças de 12h/24h/36h e capacidade máxima de quatro | só PASS | ☐ executar após `20261023000001` e `20261023000002` |
| 14 | `tests/14_category_delete_and_service_reactivation.sql` | Categoria vinculada não pode ser excluída; categoria vazia pode ser excluída por membro; serviço arquivado pode ser reativado preservando a linha | só PASS | ☐ executar após `20261023000002` |
| 15 | `tests/15_transport_delivery.sql` | Padrões 500/100; flag por serviço; pedido do cliente (endereço obrigatório, reenvio atualiza, travado depois da cotação); frete no banco (6 km = 2900; 6,5 km × 75 = 2450); confirmar/desfazer/cancelar/reabrir; sem escrita direta; reserva cancelada não cota; isolamento; anon só funções públicas | só PASS | ☐ executar após a migration `20261024000001` |
| 16 | `tests/16_admin_manual_reservations.sql` | Reservas manuais de creche e hospedagem: dados inválidos, serviço de outro tipo, usuário sem vínculo recebe NOT_FOUND, anon sem acesso (fluxo completo é conferido no painel) | só PASS | ☐ executar após a migration `20261025000001` |
| 17 | `tests/17_size_weight_ranges.sql` | Faixa de peso por porte: completa, só máximo e só mínimo; máximo menor que o mínimo, peso negativo, máximo zero e acima de 999 recusados; `list_public_sizes` devolve as faixas só dos portes ativos; usuário sem vínculo não altera; anon só lê a lista | só PASS | ☐ executar após a migration `20261026000001` |
| 19 | `tests/19_booking_horizon_admin_no_limits.sql` | Janela padrão de 60 dias; cliente vê horários, cotação e saídas até 60 dias e não além; painel lista, cota e cria horário, creche e hospedagem a 70 dias; passado continua fora; capacidade da creche vale no painel; reservas do painel ficam `admin` sem consentimento; usuário sem vínculo e anon sem acesso | só PASS | ☐ executar após a migration `20261028000001` |

No DEV, o responsável confirmou que as migrations 06 e 07 foram aplicadas e executou o teste 09. As verificações de catálogo avançaram; a falha atual indica que `get_available_slots` não filtrou o porte desativado. A migration `20261021000008_restore_active_size_slot_filter.sql` restaura esse filtro; aplique-a somente no DEV e rode novamente o teste 09, que verifica também a rejeição da reserva para a opção inativa. O schema `supabase_migrations.schema_migrations` não existe porque o projeto foi atualizado manualmente pelo SQL Editor; isso não informa quais scripts já foram executados. Confira o estado antes de reaplicar migrations. A migration 05 requer a 04; aplique/valide pendências e rode também 01, 04 e 10. As migrations `20261022000001` e `20261022000002` exigem as anteriores até a 08; depois delas rode 12, 11, 04 e 09. As migrations `20261023000001` e `20261023000002` devem ser conferidas/aplicadas nessa ordem; rode 13, 14 e 04 depois da 02. Repita **04** após qualquer migration nova; a primeira consulta deve retornar 0 linhas. Não reaplique migrations não idempotentes sem conferir o schema.

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
**Automático (Node, sem navegador):** `npm test` → 57 testes, incluindo apresentação histórica, seleção de preço/duração por porte, fusos, montagem segura do link público, agrupamento por categoria, expediente, modelos de agendamento e intervalos de horário. Última execução: `# pass 57`, `# fail 0`.

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
- [ ] Início e Calendário diferenciam agendamentos pendentes e concluídos; concluir só fica disponível depois do horário de término, exige confirmação, atualiza o status via RPC e mantém o registro visível.
- [ ] Fechar/cancelar a confirmação de conclusão não altera o status; falha da RPC mantém o modal aberto com mensagem amigável.
- [ ] Detalhes mostram serviço, porte, duração, preço e horários registrados; edição das informações do tutor/pet não altera snapshots.
- [ ] Anotações internas são salvas separadas das observações do tutor e só aparecem para membros do negócio.
- [ ] Na agenda, observações preenchidas pelo cliente e anotações internas aparecem com rótulos e cores diferentes.
- [ ] A aba Controle altera nome/foto/cor públicos; o perfil atualizado aparece na rota `/<slug>`.
- [ ] A aba Controle salva WhatsApp com DDD ou permite deixá-lo vazio; o número correto aparece como contato na página pública.
- [ ] Cabeçalho do painel e da página pública mostram a logo e o nome atualizados do estabelecimento; “Nexo Agendamentos” só aparece em tamanho pequeno no rodapé.
- [ ] Início mostra os compromissos de hoje, texto de agenda vazia e anotações internas em destaque; o link público pode ser copiado e compartilhado.
- [ ] Calendário permite escolher dia, consulta horários pelo banco e cria agendamento manual com serviço, porte, data/horário, dados do tutor/pet e observações via RPC; anotação interna é salva pela RPC separada.
- [ ] Controle carrega expediente do banco, permite deixar dias sem expediente e salvar múltiplos intervalos por dia (incluindo fechamento à meia-noite); faixas sobrepostas/inválidas são recusadas sem apagar a configuração atual.
- [ ] Calendário marca e remove folga para o dia inteiro no fuso do estabelecimento; com agendamentos confirmados, orienta cancelá-los antes; uma tentativa concorrente também é rejeitada pelo banco com mensagem compreensível.
- [ ] Em caso de falha de rede ao criar agendamento manual, a interface avisa para conferir a agenda antes de repetir; falha ao salvar nota não simula sucesso e aponta os detalhes do agendamento.
- [ ] Serviços exibem a descrição no fluxo público; porte, preço e duração configurados alimentam as novas reservas.
- [ ] Categorias podem ser criadas/editadas no Controle; serviços novos/editados exigem uma categoria e aparecem agrupados no link público, inclusive categorias vazias.
- [ ] Categoria vazia pode ser excluída com confirmação; categoria com serviço ativo ou arquivado não pode ser excluída até que os serviços sejam movidos.
- [ ] Serviços arquivados podem ser editados e reativados; ao reativar, voltam a aparecer para novas reservas e os agendamentos antigos permanecem intactos.
- [ ] Alterar o nome/descrição da categoria ou mover um serviço não modifica os snapshots de agendamentos existentes.
- [ ] Editor de serviço abre em janela própria; calendário, diálogo de criação manual e dias de reserva permanecem dentro da viewport em 375 px.
- [ ] Seleção de porte mostra seu nome, preço e duração; o resumo do atendimento permanece compacto em telas pequenas.
- [ ] Renomear ou desativar um porte não altera rótulos e snapshots de agendamentos existentes; porte desativado deixa de oferecer novos horários.

**Manual no navegador, contra o DEV** (`npm run dev`, `.env.local` com a URL e a chave anon do DEV; negócio com ao menos 1 serviço e 1 porte):
- [ ] `/<slug>` mostra nome, serviços, preços e duração; slug inexistente mostra "Página não encontrada".
- [ ] Fluxo completo: serviço/porte → dia → horário → dados → confirmar → comprovante com o horário correto.
- [ ] Cada cartão apresenta o serviço e “A partir de” com o menor preço; selecionar um porte atualiza preço/duração no resumo e inicia uma reserva para um serviço/animal. Para outro serviço ou animal, é necessário reservar outro horário.
- [ ] A página agrupa serviços por categoria e mostra título/descrição editáveis; categorias sem serviços exibem estado vazio sem oferecer reserva.
- [ ] Página inicial começa sem serviço selecionado nem carrinho; categorias aparecem recolhidas e expandem/fecham com botão acessível. Carrinho só surge após selecionar uma opção de serviço/porte.
- [ ] Texto “Atendimento com carinho” não aparece; no passo de data há separação visível aumentada entre título e cards de dia; consentimento de privacidade fica ao lado da caixa de seleção em telas mobile.
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

**Modo de agendamento por diária (manual no navegador, DEV, após a migration `20261022000001`):**
- [ ] Controle → Serviços para reserva → Adicionar serviço: seletor “Como esse serviço é agendado?” aparece com “Por horário” marcado por padrão.
- [ ] Marcar “Por diária”: o campo “Tempo (min)” some, o preço vira “Preço da diária (R$)” e o serviço salva; o cartão mostra o selo “Por diária” e “por diária” no lugar dos minutos.
- [ ] Editar um serviço existente e trocar entre horário e diária (nos dois sentidos) salva e mantém preços; agendamentos antigos não mudam.
- [ ] Link público: serviço por diária mostra “Diária a partir de”, preços por porte e o link de WhatsApp (ou o aviso sem WhatsApp), sem seleção de porte nem carrinho; serviços por horário seguem como antes.
- [ ] Calendário → novo agendamento manual não lista serviços por diária; o fluxo `/agendar` também não.
- [ ] Seletor de modo utilizável por teclado (setas/Tab, foco visível) e sem rolagem horizontal em 375 px.

**Hospedagem por diária (manual no navegador, DEV, após as migrations 20261022000001 e 20261022000002):**
- [ ] Link público: escolher serviço por diária e porte → “Escolher entrada e saída” abre `/:slug/hospedagem`.
- [ ] Com vagas: mostra “N diárias × R$ preço = total” e libera “Continuar”; os dados e a confirmação mostram entrada, saída, diárias e total.
- [ ] Com 4 estadias nas mesmas datas, a quinta tentativa mostra “Esgotado nas datas escolhidas…” com texto clicável que abre o WhatsApp do estabelecimento (mesmo número do rodapé) e “Continuar” fica desabilitado.
- [ ] Entrar no dia da saída de outra estadia lotada tem vaga; banho e tosa continua disponível no mesmo dia com o hotel lotado.
- [ ] Painel (Início e Calendário): seção “Hospedagem” lista entradas, saídas e hospedados; cancelar libera a vaga; concluir só aparece a partir do dia da saída.
- [ ] Teclado e leitor de tela nos campos de data; sem rolagem horizontal em 375 px.

**Novos modelos de serviço (manual no navegador, DEV, após as migrations 20261023000001 e 20261023000002):**
- [ ] Controle → Serviços: criar e editar modelos por horário, por período e entrada/saída; o modelo por horário mantém duração/preço atuais.
- [ ] Períodos: editar manhã/tarde, validar que integral combina o primeiro horário da manhã com o fim da tarde e definir três preços por porte; faixas sobrepostas não são aceitas.
- [ ] Página pública: manhã, tarde e integral exibem os horários configurados e seus preços; quatro vagas da manhã não bloqueiam quatro vagas da tarde.
- [ ] Duas reservas integrais e duas matinais completam a capacidade da manhã, mas mantêm duas vagas na tarde; uma nova reserva integral é recusada pelo banco se qualquer período estiver cheio.
- [ ] Hospedagem: escolher entrada (a cada 30 min desde o início da janela), data de saída e horário; o horário de saída deve corresponder à entrada após 12, 24, 36… horas e estar dentro da janela configurada.
- [ ] Após escolher a última saída do dia, a tela avisa que não há mais opção para acrescentar 12h naquele dia e orienta a alterar a entrada ou escolher a próxima data de saída.
- [ ] Cobrança: 12 h custam 0,5 diária; 24 h custam uma diária; 36 h custam 1,5; 48 h custam 2; duração fora da progressão não é apresentada.
- [ ] Quatro estadias sobrepostas ocupam a capacidade do hotel; a quinta é recusada; cancelar libera uma vaga sem afetar a capacidade independente da creche.
- [ ] Confirmação e painel mostram horários no fuso do negócio; o painel permite cancelar/concluir reserva de creche e hospedagem sem expor dados a outro negócio.
- [ ] Testar conflito concorrente com duas confirmações simultâneas por período e por hospedagem; o banco nunca ultrapassa quatro vagas.

**Hospedagem por entrada/saída em cards (manual no navegador, DEV, com as migrations 20261023000001/2 aplicadas):**
- [ ] Escolher o dia da entrada mostra os horários de entrada; hoje, os horários que já passaram ficam desabilitados.
- [ ] Só depois do horário de entrada aparece o card “Saída”; escolher o dia da saída mostra os dois horários possíveis (mesmo horário da entrada e 12 h antes/depois).
- [ ] Horário que ultrapassa a janela de retirada (ex.: entrada 15:00 gera 03:00) aparece em vermelho, não é selecionável e mostra a mensagem com a janela (ex.: 07:00 às 22:00).
- [ ] Horário esgotado aparece em cinza, “Esgotado neste horário”; sem nenhuma opção na data, o aviso oferece o WhatsApp do estabelecimento.
- [ ] O resumo mostra entrada, saída, diárias cobradas e total; o valor confere com o devolvido pelo banco; Continuar leva aos dados e a reserva confirma.
- [ ] Trocar o horário ou o dia da entrada limpa a saída escolhida e o resumo.
- [ ] Teclado (Tab/Enter nos dias, horários e cards de saída), foco visível e sem rolagem horizontal em 320 px.

**Leva e traz (manual no navegador, DEV, após a migration 20261024000001):**
- [ ] Controle → editar um serviço: aparece "Oferecer leva e traz neste serviço"; ligar e salvar mostra o selo "🚗 Leva e traz" no cartão.
- [ ] Controle → barra "Leva e traz": salvar taxa de partida e valor por km; o exemplo de 6 km acompanha os valores.
- [ ] Cliente: após agendar um serviço com leva e traz, aparece "Precisa de leva e traz?"; serviço sem a opção não mostra nada. Endereço (rua, número e bairro obrigatórios) → "Consultar valor" → botão do WhatsApp do estabelecimento com mensagem pronta com o endereço e **sem valor**.
- [ ] Início: caixa "Leva e traz" com "1 aguardando valor"; painel aberto mostra o endereço e o link do Maps.
- [ ] Informar 6 km: memória de cálculo mostra 6 km, 24 km, R$ 24,00, taxa R$ 5,00 e frete R$ 29,00. "Salvar cotação" não altera o preço da reserva nas listas.
- [ ] "Enviar valor pelo WhatsApp" abre a conversa com o número do cliente, valor e pergunta de confirmação/horário; fica desabilitado se os dados foram editados e não salvos.
- [ ] "Confirmar leva e traz" (2 etapas) soma o frete ao total na lista e nos Detalhes do agendamento; "Desfazer confirmação" tira do total; "Cancelar pedido" tira o pedido e a etiqueta.
- [ ] Mudar valor por km na calculadora oferece "Salvar esses valores como padrão"; reservas novas já abrem com os valores salvos.
- [ ] Hospedagem e creche: o mesmo painel aparece no cartão da reserva.
- [ ] 320 px sem rolagem horizontal; teclado (Tab/Enter) nos campos, botões e na barra expansível.

**Ajustes de WhatsApp e rótulos (manual, de preferência em celular real):**
- [ ] Detalhes do agendamento (painel): tocar no telefone do cliente abre a conversa no WhatsApp com aquele número.
- [ ] Leva e traz (cliente): preencher o endereço e tocar uma vez em "Consultar valor" abre o WhatsApp do estabelecimento com a mensagem pronta (endereço, linha "Mapa:" com o link e sem valor). Se o navegador bloquear a aba, o botão "Consultar valor pelo WhatsApp" aparece e funciona.
- [ ] Hospedagem (cliente): aparece "Escolher horário de entrada" acima dos horários de entrada e "Escolher horário de saída" acima das opções de saída.
- [ ] Calculadora do leva e traz: com km informado e **sem** salvar, "Enviar valor pelo WhatsApp" salva a cotação e abre a conversa com o número do cliente e o valor; sem km aparece o aviso do que falta; se o navegador bloquear a aba, aparece o link "Abrir conversa no WhatsApp".

**Horário de funcionamento e agendamento manual (manual no navegador; migration 20261025000001 para creche e hospedagem):**
- [ ] Controle → Horário de funcionamento: cartões por dia com título dentro do cartão, etiqueta Aberto/Fechado, resumo das faixas e campos de hora legíveis; "Abrir neste dia", "+ Adicionar período", "Remover" e "Copiar para os outros dias" funcionam; salvar mantém as faixas; sem rolagem horizontal em 320 px.
- [ ] Calendário → "Adicionar agendamento": aparecem todas as categorias com serviços ativos; trocar a categoria troca a lista de serviços.
- [ ] Por horário: escolher serviço, porte, data e horário livre cria o agendamento (com anotação interna opcional).
- [ ] Creche: escolher data e período mostra vagas e valor; período lotado mostra aviso e bloqueia o botão; criar aparece em "Creche por período" na data escolhida.
- [ ] Hospedagem: escolher data e horário de entrada lista as saídas por data com diárias e valor (sem vaga desabilitado); criar aparece em "Hospedagem"; reservar vários pets do mesmo tutor pelo painel não é bloqueado.

**Faixa de peso por porte (manual no navegador, após a migration 20261026000001):**
- [ ] Controle → Portes disponíveis: cada porte mostra "Peso a partir de (kg)" e "Até (kg)" e a prévia "O cliente vê: …"; salvar mantém a faixa; vazio apaga; peso inválido ou mínimo maior que o máximo mostram a mensagem.
- [ ] Faixas que se sobrepõem mostram o aviso (sem bloquear); corrigindo, o aviso some.
- [ ] Link do cliente: ao escolher o porte aparece a faixa de cada um (ex.: "até 10 kg", "10 a 25 kg", "a partir de 25 kg") e o resumo mostra o porte com a faixa; porte sem faixa não mostra nada.
- [ ] Salvar qualquer seção do Controle não fecha as seções abertas.

**Janela de 60 dias e painel sem limite (manual no navegador, após a migration 20261028000001):**
- [ ] Link do cliente: o calendário de agendamento (horário, hospedagem e creche) vai até 60 dias à frente e não permite escolher depois disso.
- [ ] Painel → Calendário → "Adicionar agendamento": numa data a 70+ dias aparecem horários livres (por horário), vagas e valor (creche) e as saídas (hospedagem); criar funciona nos três tipos e aparece no calendário da data.
- [ ] No painel, datas no passado continuam sem horários; creche lotada e hospedagem sem vaga continuam bloqueadas.


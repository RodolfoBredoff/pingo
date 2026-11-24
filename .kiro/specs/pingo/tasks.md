# Plano de implementação: Pingo

Local-first: o app funciona sozinho (simulador + IA) antes de qualquer AWS ou WhatsApp. Nada aqui foi executado ainda.

## Fase 0: Fundações (concluída)
- [x] 0.1 Instalar pnpm; criar monorepo (`apps/pingo`, `apps/relay`, `packages/core`, `packages/shared`) com TypeScript, ESLint e Prettier
- [x] 0.2 `git init`, `.gitignore` (inclui `.env*`, `*.sqlite`, `cdk.out`, `src-tauri/target`) e `.env.example` sem valores
- [x] 0.3 Criar app Tauri 2 + React + Vite + Tailwind abrindo uma janela "olá"
- [x] 0.4 **Spike:** SQLite local via `tauri-plugin-sql` + Drizzle (sqlite-proxy); gravar e ler uma linha. Resultado: funciona; migrations sem transação e JOINs com colunas de mesmo nome exigem alias
- [x] 0.5 **Spike:** guardar e ler um segredo no keychain do sistema. Resultado: crate `keyring` 4 (modo v1) + comandos Rust `secret_set/get/delete` com lista de chaves permitidas
- [x] 0.6 Esquema e migrations do banco local (design §4)
- [x] 0.7 Interface `Channel` e tipos compartilhados (mensagem, botão, cartão, lista, template)
- [x] 0.8 Logger sem conteúdo sensível

## Fase 1: Núcleo e IA via OpenRouter (R1, R2, R3, R10) (concluída)
- [x] 1.1 Cliente OpenRouter com `baseUrl` configurável, `models` em ordem, `provider` (sort, require_parameters, data_collection, allow_fallbacks) e registro de custo
- [x] 1.2 Carregar `config/models.json` (roles text/vision/pdf/audio) com validação zod
- [x] 1.3 Extrator com JSON Schema, validação zod, retentativa e próxima alternativa
- [x] 1.4 Envio de imagem, PDF e áudio como conteúdo multimodal; guardar `transcript`
- [x] 1.5 Resolução de datas relativas e fuso
- [x] 1.6 Casamento de nomes com contatos
- [x] 1.7 Orquestrador de conversa (Idle, Processing, Proposal, Editing, Offering) e idempotência por `channel_msg_id`
- [x] 1.8 Confirmar / Descartar / Editar por texto livre / Expirar em 48 h
- [x] 1.9 Teto diário e mensal de custo
- [x] 1.10 **Conjunto de referência:** 36 casos com extração esperada (sintéticos; trocar por reais antes do go-live)
- [x] 1.11 **Comparador de modelos:** roda os candidatos sobre o conjunto e mostra acertos, falhas e custo; fixar os padrões em `models.json`
- [x] 1.12 `pnpm models:suggest`: lista os mais baratos por modalidade a partir do catálogo público (exclui `:batch`, `:free`, aliases `~`)

## Fase 2: App local e simulador com design (R8) (concluída, com 3 ressalvas abaixo)
- [x] 2.1 Tokens de cor, tipografia e espaçamento (claro e escuro); fontes empacotadas no app
- [x] 2.2 Ícones Phosphor e mapa tipo→ícone/cor
- [x] 2.3 Layout do chat (desktop e janela estreita simulando celular)
- [x] 2.4 Componentes: bolha, digitando, botões de resposta, lista, toast
- [x] 2.5 Cartão "Entendi assim": cascata de campos, "não informado". **Ressalva:** a edição é por texto livre no chat (o Editar abre o pedido "o que mudar?"); campos editáveis dentro do cartão ficam para depois
- [x] 2.6 Animação de confirmar (check radial, voo até a Agenda, confete) e gestos de deslizar
- [x] 2.7 Barra de entrada: anexar imagem/PDF, gravar áudio com onda, chips de atalho
- [x] 2.8 `SimulatorChannel` ligado ao core
- [x] 2.9 Aba Agenda (leitura) com transição compartilhada
- [x] 2.10 Transições de tela. **Ressalva:** feitas só com Motion (deslize direcional entre abas); a View Transitions API não foi usada
- [x] 2.11 Painel de desenvolvedor: relógio virtual, JSON da extração, modelo e custo
- [x] 2.12 Tela de configurações: chave OpenRouter (keychain), tetos de custo, fuso, modelos
- [x] 2.13 Acessibilidade e `prefers-reduced-motion`
- [x] 2.14 Revisão visual. **Ressalva:** feita por autoteste no app real (fontes, layout, erros de JS, fluxo); a revisão de olho é sua. Rode `VITE_PINGO_SELFTEST=1 pnpm tauri dev` em apps/pingo para repetir o autoteste

## Fase 3: Agenda, contatos e lembretes locais (R4, R5, R6) (concluída)
- [x] 3.1 Consultas: `hoje`, `amanhã`, `semana`, `pendentes` (comandos exatos, sem IA) e pergunta livre ("o que tenho sexta?") roteada pela IA só quando o texto parece pergunta
- [x] 3.2 `feito <texto>` / `cancelar <texto>`, também pelos botões e pela aba Agenda (com aba "Feitos")
- [x] 3.3 Contatos (`adiciona Renato 11 98888-7777`, `contatos`, `remove contato`, e tela em Ajustes); oferta com Aceito / Não posso no simulador (a primeira mensagem já pede a permissão, R6.3)
- [x] 3.4 Lembretes padrão por tipo calculados pelo código (ver design.md §8.1)
- [x] 3.5 Agendador local (confere a cada 15 s) com notificação do sistema (`tauri-plugin-notification`)
- [x] 3.6 Adiar 1 h / Amanhã 9h e Feito pelo botão do lembrete
- [x] 3.7 Bandeja do sistema (Abrir/Sair), fechar a janela só a esconde, clique no Dock reabre, início com o computador (Ajustes)
- Verificado: `pnpm --filter @pingo/core phase3` (determinístico, sem custo, 43 checagens) e `pnpm --filter @pingo/core e2e` (IA real, inclui a pergunta "o que tenho sexta?")
- Autoteste no app real (`VITE_PINGO_SELFTEST=1 pnpm tauri dev`): 39 verificações ok, sem erro de JavaScript. Cobre comandos, contato com oferta e aceite, lembrete disparado com o relógio adiantado, Feito pela Agenda e remoção de contato.
- **Ressalva:** com a janela escondida o WebView pode atrasar os timers (App Nap). Confirmar no piloto; se atrasar, o lembrete na nuvem (Fase 6) cobre.

## Fase 4: Privacidade e backup (R7, R11) (concluída, exceto 4.4 que passou para a Fase 6)
- [x] 4.1 Cadastro em dois passos (nome e WhatsApp opcional, depois o aviso de privacidade com aceite). Quem já usava antes, ou se o texto mudar (`CONSENT_VERSION`), vê só o aviso
- [x] 4.2 "Apagar meus dados": em Ajustes (digitar APAGAR; opção de remover a chave do cofre) e pelo chat ("apagar meus dados" + botão que vale 2 min). Apaga o banco local e reinicia no cadastro; a nuvem entra na Fase 6
- [x] 4.3 Backup em arquivo `.json` versionado (exportar, importar, automático diário ou semanal numa pasta escolhida, mantém os 7 mais recentes). A importação valida tudo antes de tocar no banco e restaura os dados anteriores se falhar no meio
- [ ] 4.4 Limpeza de mídia local antiga: **movida para a Fase 6**. Hoje nenhuma mídia é gravada em disco (imagem, PDF e áudio vão direto para a IA e somem); só passa a existir quando o WhatsApp entrar
- Verificado: `pnpm --filter @pingo/core phase4` (sem custo, 33 checagens) e o autoteste no app real, incluindo "apagar meus dados" pelo chat com recarga da página
- **Não automatizável (precisa de você):** as janelas nativas de escolher arquivo e pasta. Teste à mão: Ajustes → Exportar, Importar e Backup automático
- **Decisões:** o backup não é criptografado e não leva a chave do OpenRouter; "apagar" não mexe em backups que você salvou em suas pastas

## Fase 5: Relay AWS (R9, R11) (concluída; falta só o e-mail dos alarmes e as credenciais reais da Meta)
Conta `publishing` (025843049355), região `sa-east-1`, pilha `PingoRelay`. A trava em `bin/relay.ts` e `scripts/lib/aws.ts` recusa qualquer outra conta.
- [x] 5.1 Projeto CDK em `apps/relay`; `cdk bootstrap` feito na conta/região
- [x] 5.2 DynamoDB (TTL), SQS FIFO + DLQ, SQS de falhas de lembrete, bucket S3 privado com expiração de 1 dia, grupo do Scheduler. Credenciais Meta no SSM (SecureString, fora do CDK)
- [x] 5.3 Webhook: verificação GET, assinatura HMAC sobre os bytes brutos (falha fechada), idempotência, lista de permitidos, janela de 24 h, "Recebi!" no máximo 1 vez a cada 10 min com o app offline
- [x] 5.4 Rotas do dispositivo: `pair`, `inbox` (long poll de até 20 s), `inbox/ack`, `outbox`, `media`, `allowlist`, `reminders` (PUT/DELETE), `me`
- [x] 5.5 `send-reminder` e agendamentos únicos no EventBridge Scheduler (3 tentativas, fila de falhas, se apaga depois de rodar)
- [x] 5.6 Token de dispositivo guardado como hash; limites de taxa (20 req/s geral, 1 req/s no pareamento); logs de 14 dias, sem conteúdo de mensagem
- [x] 5.7 Alarmes (SNS): fila de falhas da entrada, lembrete não entregue, erro no webhook, erro no `send-reminder`, volume anormal de chamadas. **Pendente:** informar o e-mail para assinar o tópico
- [x] 5.8 `pnpm relay:set-secret <nome>`: valor digitado sem eco, direto para o SSM; `--generate` cria o token de verificação
- [x] 5.9 `pnpm relay:test` (130 checagens, handlers com AWS e Meta em memória) e `pnpm relay:smoke [--fire]` (chamadas reais à AWS, incluindo um lembrete que dispara de verdade)
- **Decisões:** a lista de permitidos tem papéis (`owner` e `contact`); só o dono recebe "Recebi!". Todo envio exige número da lista. O pareamento usa um código de uso único gerado com `pnpm relay:pair-code` (quem tem credencial AWS autoriza o dispositivo). Celular brasileiro sem o 9º dígito é normalizado. A API da Meta é a v25.0 (configurável com `GRAPH_API_VERSION`)
- **Pendentes de verificação com a Meta real (Fase 6):** formato exato dos modelos e botões de resposta rápida, áudio OGG/Opus na extração, e o orçamento de custo (ver go-live)
- Os valores em `/pingo/meta/*` hoje são de TESTE (criados pelo smoke). Troque com `pnpm relay:set-secret` antes de ligar a Meta

## Fase 6: Canal WhatsApp (R9) (em andamento: o lado do app está pronto; falta a Meta)
- [ ] 6.1 Cadastro Meta e número de teste (ver `go-live.md`, que agora traz o texto exato dos 4 modelos a submeter)
- [ ] 6.0 Limpeza de mídia local antiga (veio da 4.4): o app não grava mídia em disco (ela passa pela memória e vai à IA), então por enquanto não há o que limpar. Reavaliar se um dia o app guardar originais
- [x] 6.2 `RelayChannel` (`packages/core/src/channels`): pareamento, long polling com ack só depois de tratar, reconexão com espera crescente, envio, mídia por link temporário. `MultiChannel` junta a conversa do app e o WhatsApp
- [x] 6.2b No app: Ajustes → WhatsApp (número do dono, endereço do relay, código de pareamento, estado da conexão, desligar). Token no cofre do sistema; fala com a AWS pelo plugin HTTP do Tauri, liberado só para `*.execute-api.sa-east-1.amazonaws.com` e o S3 de `sa-east-1`
- [x] 6.3a Lista de números permitidos sincronizada ao conectar e a cada contato adicionado ou removido
- [ ] 6.3b Lembretes na nuvem (criar/cancelar ao confirmar, editar, concluir). As rotas e o `RelayChannel.putReminder/deleteReminder` existem; falta ligar ao orquestrador
- [ ] 6.4 Idempotência de lembretes entre local e nuvem (depende da 6.3b)
- [x] 6.5 Contato aceita ou recusa pelos botões do modelo (resposta rápida chega como botão); verificado no teste integrado
- [x] 6.6 "Apagar meus dados" também na nuvem: apaga o relay primeiro e, se falhar, não apaga nada local
- [ ] 6.7 Testes ponta a ponta com o número de teste da Meta
- [ ] 6.8 (Opcional) Cartão como imagem via satori/resvg
- Verificado: `pnpm --filter @pingo/relay test:channel` (relay real em memória + RelayChannel + orquestrador: webhook assinado → fila → app → resposta, modelos de reserva fora da janela, aceite do contato, lembretes, queda de rede, revogação) e o autoteste do app
- **Decisões:** mensagens ao dono vão ao WhatsApp quando a última veio de lá ou quando são avisos por iniciativa do Pingo; o app sempre espelha tudo. Lembrete e oferta carregam um modelo de reserva (`fallback`). Foi acrescentado o modelo `lembrete_contato`, então são 4 modelos
- **Riscos a validar com a Meta real:** áudio de voz do WhatsApp (OGG/Opus) na extração; formato exato dos botões de resposta rápida nos modelos; o app só confirma a mensagem depois de tratá-la, mas se travar no meio do tratamento a mensagem reentregue é descartada como duplicada

## Fase 7: Hardening e go-live
- [ ] 7.1 Revisão de segurança (assinaturas, tokens, IAM, bucket, logs)
- [ ] 7.2 Empacotar o app (macOS primeiro) e assinar/notarizar se for distribuir
- [ ] 7.3 Piloto de 1 semana com uso real; coletar erros de extração e ajustar `models.json`
- [ ] 7.4 Executar `go-live.md`

## Fase 8: Smartphone
- [ ] 8.1 Instalar Xcode e/ou Android Studio; inicializar alvos mobile do Tauri
- [ ] 8.2 Adaptar layout e gestos para toque
- [ ] 8.3 Validar SQLite, keychain, notificações e microfone no aparelho
- [ ] 8.4 Documentar a limitação de segundo plano; avaliar Capacitor se o Tauri mobile não atender

## O que preciso de você, por fase
| Quando | O quê |
|---|---|
| Fase 1 | Chave do OpenRouter (vai no app, ver abaixo) |
| Fase 5 | Confirmar perfil e região AWS; ter permissão para criar recursos (CDK) |
| Fase 6 | Conta Meta Business, número dedicado, token e app secret |
| Fase 8 | Xcode completo (iPhone) ou Android Studio |

## Onde ficam as chaves
- **OpenRouter:** em desenvolvimento, `.env.local` na raiz (ignorado pelo git). No app, tela Configurações → grava no keychain do sistema.
- **Meta (WhatsApp):** nunca no app. Vão para o SSM da AWS via `pnpm relay:set-secret`.
- **Token do relay:** gerado no pareamento e guardado no keychain.
- **Nunca cole chaves no chat.**

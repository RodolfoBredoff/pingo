# Plano de tarefas: Pingo

**Revisão de 23/11/2026.** O Pingo vira um app de celular (Android primeiro) alimentado pelo menu Compartilhar, sem Meta. As Fases 0 a 5 estão feitas e continuam valendo (núcleo, IA, interface, agenda, privacidade). A Fase 5 (relay AWS) foi pausada e a pilha destruída. As Fases 6 em diante são novas.

Regras de ouro desta etapa: **provar o risco antes de construir** (Fase 6) e **custo mínimo na AWS** (hoje nada roda lá; ver R13).

## Onde paramos (começa aqui)

**Estado em 27/11/2026.** Decisão tomada na prática: **app nativo (Tauri) no Android**; o PWA (Fase 6B) não foi testado e fica como alternativa guardada. O app roda num Redmi Note 11 (Android 13) ligado por cabo. Já funcionam: chave no Keystore, Compartilhar de texto (app aberto), IA extraindo cartões, agenda, e **lembretes agendados no sistema** (chegaram com o app fechado e a tela travada). Chave do OpenRouter entra no aparelho de teste por `adb run-as` a partir do `.env.local` (só build de depuração).

**Teste guardado, ainda por fazer: reiniciar o celular com alarme pendente (6.3).**
1. Mover um lembrete para daqui a ~6 min: `adb shell am force-stop br.com.pingo.app`; copiar `pingo.db`, `-wal`, `-shm` com `adb exec-out run-as br.com.pingo.app cat <arquivo>`; no Mac, `sqlite3 pingo.db "update reminders set remind_at='<UTC +6 min>' where status='pending' ..."` e `pragma wal_checkpoint(TRUNCATE)`; apagar `-wal`/`-shm` no aparelho e devolver o `pingo.db` com `run-as ... sh -c 'cat > pingo.db'`; abrir o app uma vez (ele agenda); conferir com `adb shell dumpsys alarm | grep -A2 "Alarm{.*br.com.pingo.app}"`.
2. `adb reboot`. A pessoa só desbloqueia e **não abre o Pingo**.
3. Passa se a notificação chegar sozinha. Se não chegar, o plano B da 6.3 é um receptor de reinício no plugin próprio que reagenda a partir do banco.
4. Depois: ~15 min parado (economia de bateria) e ações Feito/Adiar.

**Também falta no Fase 6:** 6.2 (foto, PDF, áudio do WhatsApp, início a frio), 6.5 (microfone), 6.6 (OGG/Opus), 6.7 (Auto Backup). Defeitos visuais anotados: na Agenda o botão ✕ do cartão fica cortado na borda direita, e o título do dia sai como "Quinta-Feira, 3 De Dezembro" com faixa escura.

**Pergunta em aberto (27/11):** como escalar sem chave de IA por pessoa. Opções analisadas no `design.md` (Apêndice A) e na conversa: servidor de IA próprio, login com OpenRouter (cada pessoa paga o seu), IA no aparelho. Nada decidido.

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
- **Ressalva:** com a janela escondida o WebView pode atrasar os timers (App Nap). Confirmar no piloto; no Android os lembretes passam a ser do sistema (Fase 9).

## Fase 4: Privacidade e backup (R7, R11) (concluída; a 4.4 voltou como 8.6)
- [x] 4.1 Cadastro em dois passos (nome e WhatsApp opcional, depois o aviso de privacidade com aceite). Quem já usava antes, ou se o texto mudar (`CONSENT_VERSION`), vê só o aviso
- [x] 4.2 "Apagar meus dados": em Ajustes (digitar APAGAR; opção de remover a chave do cofre) e pelo chat ("apagar meus dados" + botão que vale 2 min). Apaga o banco local e reinicia no cadastro; a nuvem entra na Fase 6
- [x] 4.3 Backup em arquivo `.json` versionado (exportar, importar, automático diário ou semanal numa pasta escolhida, mantém os 7 mais recentes). A importação valida tudo antes de tocar no banco e restaura os dados anteriores se falhar no meio
- [ ] 4.4 Limpeza de mídia local antiga: **passou para a 8.6**. Só passa a haver mídia em disco com o Compartilhar (arquivos temporários em `cache/shared`)
- Verificado: `pnpm --filter @pingo/core phase4` (sem custo, 33 checagens) e o autoteste no app real, incluindo "apagar meus dados" pelo chat com recarga da página
- **Não automatizável (precisa de você):** as janelas nativas de escolher arquivo e pasta. Teste à mão: Ajustes → Exportar, Importar e Backup automático
- **Decisões:** o backup não é criptografado e não leva a chave do OpenRouter; "apagar" não mexe em backups que você salvou em suas pastas

## Fase 5: Relay AWS (R9, R11) (concluída e depois PAUSADA: pilha destruída em 23/11/2026; ver Fase 16)
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

## Fase 6: Prontidão e protótipos Android (provar antes de construir)
Cada protótipo é pequeno, descartável e termina com uma decisão registrada em `design.md`. Resultados esperados e planos B abaixo.

- [x] 6.0 **Ambiente.** Android Studio (`brew install --cask android-studio`, abrir uma vez para baixar o SDK), SDK Platform (API 35 ou mais nova), Platform-Tools, Command-line Tools, Build-Tools e NDK. No `~/.zshrc`: `JAVA_HOME` (o JDK do Android Studio), `ANDROID_HOME`, `NDK_HOME`. Celular com Depuração USB. Pronto quando `pnpm android:doctor` terminar verde. *(Alvos Rust do Android: feito em 23/11/2026. Disco: ~22 GB livres; use o celular e evite o emulador.)*
- [x] 6.1 **Protótipo 1: o app roda no Android.** *(Feito em 27/11/2026 num Redmi Note 11, Android 13: onboarding, conversa, SQLite e fontes OK. `adb install` é bloqueado pela Xiaomi sem SIM; o APK é enviado com `adb push` e instalado pelo instalador do sistema.)* `pnpm tauri android init`, ícones, `pnpm tauri android dev`. Pronto quando: onboarding → conversa funciona, o SQLite grava e lê, as fontes carregam e `dev_log` aparece no `adb logcat`. Inclui separar as dependências do Cargo por plataforma (`keyring`, autostart, persisted-scope, bandeja) sem quebrar o desktop. *Plano B: ajustar versões do Tauri/NDK.*
- [ ] 6.2 **Protótipo 2: Compartilhar.** *(Parcial em 27/11: texto compartilhado com o app aberto virou cartões. Falta: foto, PDF, áudio do WhatsApp e início a frio.)* Plugin mínimo que declara os filtros de Intent e devolve texto ou arquivo. Testar com uma foto, um PDF e uma **nota de voz do WhatsApp**, com o app fechado e com o app aberto. Pronto quando: os bytes chegam idênticos, até 10 MB, sem pedir permissão de arquivos. *Plano B: receptor nativo em Kotlin mais completo; plugin de terceiros só como referência.*
- [ ] 6.3 **Protótipo 3: lembretes.** *(Parcial em 27/11: o plugin oficial agendou alarmes `RTC_WAKEUP` aproximados (janela do sistema) e a notificação chegou com o app fechado pelos recentes e a tela travada, menos de 1 min depois do horário. Decisão provisória: plugin oficial (a), sem alarme exato. Falta: reiniciar o aparelho, ficar ~15 min parado, Feito/Adiar e a conferência da economia de bateria da Xiaomi. Achados: `pending()` do plugin devolve JSON inválido no Android, então o app guarda a própria lista de ids; `force-stop` apaga os alarmes, então todo início reagenda tudo; o driver do banco embaralha JOIN com colunas de mesmo nome, use consultas separadas.)*  Agendar uma notificação para daqui a 2 min com o app **fechado**; depois repetir **reiniciando o celular** e com o aparelho parado por ~15 min (modo de economia). Testar as ações Feito / Adiar. Decide: plugin oficial de notificações (a) ou alarmes e receptor de boot no plugin próprio (b). *Plano B: (b).*
- [x] 6.4 **Protótipo 4: cofre.** *(Feito: plugin `tauri-plugin-pingo`, AES-GCM com chave no Keystore.)* Guardar e ler uma chave no Keystore (plugin próprio, comandos `secret_*`). Pronto quando a mesma interface TypeScript serve ao macOS e ao Android.
- [ ] 6.5 **Protótipo 5: microfone.** Gravar áudio pela interface (permissão do sistema + liberar o pedido da WebView) e transcrever. *Plano B: gravação nativa pelo plugin.*
- [ ] 6.6 **Protótipo 6: áudio do WhatsApp (OGG/Opus).** Decodificar na WebView (`toWav`) ou enviar o OGG direto ao modelo (já medido: 3/3 com Gemini Flash Lite). Escolher o caminho mais simples que funciona.
- [ ] 6.7 **Protótipo 7: Auto Backup.** Ativar, usar o app, forçar backup e restauração (`adb shell bmgr`). Pronto quando se sabe se o banco volta e se as chaves ficam de fora.
- [ ] 6.8 Registrar resultados e decisões em `design.md` (§5, §6, §8.4, §12) e ajustar esta lista.

## Fase 6B: Protótipo PWA (alternativa à Fase 6; decide o caminho)
`apps/pwa-lab` é descartável e não é o app. Resumo do que mede e o que já foi verificado está no README dele.
- [x] 6B.0 Laboratório montado e **verificado no Chrome do Mac** (24/11/2026): SQLite WASM + OPFS grava 1000 linhas e mantém depois de recarregar; o service worker intercepta o POST do Compartilhar e guarda texto e PDF; permissão e inscrição de push funcionam (FCM aceitou o envio, 201). Corrigido no caminho: a tela travava na primeira abertura esperando a inscrição de push
- [ ] 6B.1 Instalar no celular (Chrome → Instalar app) e confirmar que abre como app e se o armazenamento fica permanente
- [ ] 6B.2 **Compartilhar** do WhatsApp para o Pingo Lab: texto, foto, PDF e nota de voz, com o app **fechado** e **aberto**. Conferir tipos, tamanhos, bytes e a decodificação do OGG/Opus
- [ ] 6B.3 **Push**: agendar 2 min, fechar o app e bloquear a tela; medir o atraso; tocar em Feito/Adiar; repetir com 10 min e tela apagada (economia de bateria) e **depois de reiniciar o celular**
- [ ] 6B.4 **SQLite**: gravar, fechar o app por completo, abrir e conferir as linhas
- [ ] 6B.5 **Microfone**: gravar 5 s, formato gerado e reprodução
- [ ] 6B.6 **Decidir.** O PWA segue se: Compartilhar funciona com o app fechado; o push chega em até 5 min em quase todos os testes, inclusive com a tela bloqueada e após reiniciar; o banco persiste; o microfone grava. Se o push falhar de forma frequente, o PWA sai e vamos de nativo. Registrar o resultado em `design.md`
- [ ] 6B.7 **Se o PWA vencer:** estimar o custo do servidor de push (Lambda + EventBridge Scheduler + DynamoDB; o payload leva só o id) e reescrever as Fases 7 a 13 para PWA: banco `sqlite-wasm` no driver do Drizzle, cofre da chave com WebCrypto, backup pelo Compartilhar do sistema, notificações pelo service worker, hospedagem estática (ex.: Cloudflare Pages ou GitHub Pages), e o que fazer no iPhone (sem Compartilhar)
- **Limitações já conhecidas do PWA:** sem aviso local agendado (precisa de servidor); iPhone não recebe Compartilhar (Safari); se a pessoa limpar os dados do Chrome, o banco some; sem Keystore (a chave do OpenRouter fica protegida só pelo navegador); exige um endereço público estático

## Fase 7: Alicerce Android (R8)
- [ ] 7.1 Projeto Android gerado e **versionado** (`src-tauri/gen/android` no git; ajustar o `.gitignore`)
- [ ] 7.2 Compilar para Android e desktop com o mesmo código (dependências por plataforma); autoteste do desktop continua passando
- [ ] 7.3 `packages/tauri-plugin-pingo` (Rust + Kotlin): esqueleto + cofre no Keystore ligado a `src/db/secrets.ts`
- [ ] 7.4 Microfone funcionando (conforme 6.5)
- [ ] 7.5 Interface de celular: áreas seguras, teclado, botão voltar, alvos de 48 dp, barra de abas acima da barra de gestos; revisão no aparelho
- [ ] 7.6 Autoteste no Android: `VITE_PINGO_SELFTEST=1 pnpm tauri android dev`, com `dev_log` indo ao logcat
- [ ] 7.7 Onboarding do celular: consentimento, nome e **colar a chave do OpenRouter** (sem pedir o número de WhatsApp); esconder a seção "WhatsApp" de Ajustes por uma chave de recurso
- [ ] 7.8 **APK assinado** de teste: chave de assinatura guardada fora do git, `pnpm tauri android build --apk`, instalação por `adb install` e depois por arquivo; documentar

## Fase 8: Compartilhar → Pingo (R1, R9, R11.1)
- [ ] 8.1 Migration: `messages.state`, `attempts`, `content_hash` (design §4)
- [ ] 8.2 Plugin: filtros de Intent (`text/plain`, `image/*`, `application/pdf`, `audio/*`), `singleTask`, `take_shared`, cópia para `cache/shared`, limite de 10 MB, evento "há algo novo"
- [ ] 8.3 Core: entrada por Compartilhar (`ChannelId` novo) grava como pendente e processa; reprocessa pendentes ao abrir e ao voltar ao primeiro plano; aviso de conteúdo repetido por hash; apaga o arquivo ao terminar
- [ ] 8.4 Interface: abrir na conversa com "organizando…"; vários arquivos em sequência; mensagens amigáveis (tipo não suportado, acima de 10 MB, sem internet: "processo quando a internet voltar")
- [ ] 8.5 Verificação: script determinístico no core (pendente, reprocesso, duplicata) + roteiro no aparelho: foto, PDF, nota de voz, texto longo, app fechado e aberto, sem internet, **matar o app no meio da IA**
- [ ] 8.6 Limpeza: ao iniciar, apagar de `cache/shared` os arquivos sem entrada pendente ou com mais de 24 h (era a 4.4)

## Fase 9: Lembretes pelo sistema (R5)
- [ ] 9.1 Migration: `reminders.os_id`, `body`, `kind`
- [ ] 9.2 `ReminderPlanner` no core + porta de notificações do sistema (agendar, cancelar, listar) com versão falsa para testes, e a implementação Android (conforme 6.3)
- [ ] 9.3 Reconciliar ao abrir, ao voltar ao primeiro plano e a cada confirmar, editar, concluir, cancelar e adiar
- [ ] 9.4 Texto da notificação composto na hora de agendar (`relativeWhen` com o horário do disparo)
- [ ] 9.5 Ações Feito / Adiar 1 h / Amanhã 9h e tratamento quando o app abre por uma ação
- [ ] 9.6 Ciclo com o app aberto só posta na conversa (sem notificação duplicada); lembretes vencidos aparecem ao abrir
- [ ] 9.7 Permissão de notificações com explicação e faixa "lembretes desligados"; orientação sobre economia de bateria
- [ ] 9.8 Reagendar depois de reiniciar o aparelho (conforme 6.3)
- [ ] 9.9 Verificação: planner no core com notificações falsas + roteiro no aparelho (+2 min, fechar, reiniciar, adiar, concluir)

## Fase 10: Contatos e delegação manual (R6)
- [ ] 10.1 Simplificar `contacts` (sem opt-in) e tirar o número de WhatsApp do cadastro do dono (migration)
- [ ] 10.2 "Passar para…" monta o texto (`renderCardText` + "Responda *ok* para confirmar") e abre `wa.me`; `ReplyButton` ganha `url`
- [ ] 10.3 Estados `offered` / `accepted` / `declined` por ação do dono: "Confirmou" e "Recusou" no item e na Agenda
- [ ] 10.4 Lembrete de cobrança (`nudge`) em 24 h ou na véspera, com Reenviar e Confirmou
- [ ] 10.5 Lembretes do dono mostram o responsável
- [ ] 10.6 Tirar do caminho do app: `onContactEvent`, modelos da Meta, `lembrete_contato`
- [ ] 10.7 Verificação: core + aparelho com WhatsApp real (a conversa abre com o texto pronto)
- [ ] 10.8 (Opcional) Escolher contato pelo seletor do Android, que não exige permissão

## Fase 11: Backup e privacidade no Android (R7, R11.3)
- [ ] 11.1 Exportar pelo Compartilhar do sistema (`share_file`); importar pelo seletor de arquivo
- [ ] 11.2 Auto Backup do Android com regras (conforme 6.7), deixando as chaves de fora
- [ ] 11.3 "Apagar meus dados" limpa também `cache/shared` e o Keystore
- [ ] 11.4 Revisar o texto de consentimento (`CONSENT_VERSION` 2): Compartilhar, IA via OpenRouter e, no público, servidor de IA
- [ ] 11.5 Rascunho da política de privacidade (necessária só no público)

## Fase 12: Piloto com pessoas (R10.8, R12.1)
- [ ] 12.1 Criar **uma chave do OpenRouter por pessoa com teto de gasto** (ex.: US$ 2) e entregar em particular; planilha de controle fora do repositório
- [ ] 12.2 Entregar o APK com um guia de uma página (instalar, permissões, como compartilhar do WhatsApp)
- [ ] 12.3 Coletar erros de extração e trocar os casos sintéticos do conjunto de referência por mensagens reais anonimizadas; reavaliar `models.json` com `pnpm compare`
- [ ] 12.4 Medir custo por pessoa e por semana, tempo de resposta e **pontualidade dos lembretes** em marcas diferentes (Samsung, Xiaomi, Motorola)
- [ ] 12.5 Critérios para abrir ao público: uma semana sem perder mensagem, lembretes dentro de 5 minutos em quase todos os casos, custo por pessoa conhecido

## Fase 13: Público: servidor de IA e Google Play (R10.9, R12, R13)
**Regra:** AWS só serverless, sem recurso fixo, com teto de gasto que desliga sozinho. Medir antes de abrir.
- [ ] 13.1 Decidir: região (`sa-east-1` × `us-east-1`), API Gateway HTTP × URL de função, limite do plano gratuito, conta de desenvolvedor da Play (pessoal × organização)
- [ ] 13.2 `apps/ai-server` (CDK, reaproveitando padrões do relay): `register`, `chat/completions`, `me`; DynamoDB com TTL; Lambda ARM
- [ ] 13.3 Atestado do aparelho (Play Integrity), token por dispositivo (hash), cotas por dia e mês, **teto global diário com desligamento automático**, modelos e parâmetros restritos pelo servidor
- [ ] 13.4 Alarmes mínimos e orçamento mensal filtrado por `app=pingo`; logs de até 14 dias, sem conteúdo
- [ ] 13.5 Cliente: `baseUrl` + token, escolha entre modo piloto e modo público
- [ ] 13.6 `test` e `smoke` do servidor + **medição de custo com tráfego real** antes de abrir
- [ ] 13.7 Política de privacidade pública (ex.: GitHub Pages) e formulário de segurança de dados
- [ ] 13.8 Conta de desenvolvedor da Play, AAB assinado, ficha da loja, **teste fechado com 12 testadores por 14 dias** (começar cedo), produção

## Fase 14: Assinatura paga (adiada)
- [ ] 14.1 Definir plano e preço depois de conhecer o custo real por usuário (Fase 12 e 13)
- [ ] 14.2 Cobrança pela Play (assinatura) e ligação com as cotas do servidor

## Fase 15: iPhone (adiada)
- [ ] 15.1 Xcode completo e conta Apple Developer (paga)
- [ ] 15.2 Extensão de compartilhamento nativa (Share Extension), notificações agendadas, Keychain
- [ ] 15.3 TestFlight e App Store

## Fase 16: Canal WhatsApp via Meta (PAUSADO; guardado)
O código existe e está testado, mas **nada está implantado**: a pilha `PingoRelay` foi destruída em 23/11/2026. Para retomar: `pnpm relay:deploy`, `pnpm relay:set-secret` e `pnpm relay:pair-code`. Itens que ficaram abertos:
- [ ] 16.1 Cadastro Meta e número de teste (ver `go-live.md`, que agora traz o texto exato dos 4 modelos a submeter)
- [x] 16.2 `RelayChannel` (`packages/core/src/channels`): pareamento, long polling com ack só depois de tratar, reconexão com espera crescente, envio, mídia por link temporário. `MultiChannel` junta a conversa do app e o WhatsApp
- [x] 16.2b No app: Ajustes → WhatsApp (número do dono, endereço do relay, código de pareamento, estado da conexão, desligar). Token no cofre do sistema; fala com a AWS pelo plugin HTTP do Tauri, liberado só para `*.execute-api.sa-east-1.amazonaws.com` e o S3 de `sa-east-1`
- [x] 16.3a Lista de números permitidos sincronizada ao conectar e a cada contato adicionado ou removido
- [ ] 16.3b Lembretes na nuvem (criar/cancelar ao confirmar, editar, concluir). As rotas e o `RelayChannel.putReminder/deleteReminder` existem; falta ligar ao orquestrador
- [ ] 16.4 Idempotência de lembretes entre local e nuvem (depende da 16.3b)
- [x] 16.5 Contato aceita ou recusa pelos botões do modelo (resposta rápida chega como botão); verificado no teste integrado
- [x] 16.6 "Apagar meus dados" também na nuvem: apaga o relay primeiro e, se falhar, não apaga nada local
- [ ] 16.7 Testes ponta a ponta com o número de teste da Meta
- [ ] 16.8 (Opcional) Cartão como imagem via satori/resvg
- Verificado: `pnpm --filter @pingo/relay test:channel` (relay real em memória + RelayChannel + orquestrador: webhook assinado → fila → app → resposta, modelos de reserva fora da janela, aceite do contato, lembretes, queda de rede, revogação) e o autoteste do app
- **Decisões:** mensagens ao dono vão ao WhatsApp quando a última veio de lá ou quando são avisos por iniciativa do Pingo; o app sempre espelha tudo. Lembrete e oferta carregam um modelo de reserva (`fallback`). Foi acrescentado o modelo `lembrete_contato`, então são 4 modelos
- **Riscos a validar com a Meta real:** áudio de voz do WhatsApp (OGG/Opus) na extração; formato exato dos botões de resposta rápida nos modelos; o app só confirma a mensagem depois de tratá-la, mas se travar no meio do tratamento a mensagem reentregue é descartada como duplicada


## O que preciso de você, por fase
| Quando | O quê |
|---|---|
| Amanhã (Fase 6) | Celular Android com cabo e Depuração USB; Android Studio instalado e aberto uma vez |
| Fase 7 | Decidir o `applicationId` (sugestão: `br.com.pingo.app`) |
| Fase 12 | Lista de pessoas do piloto; criar as chaves do OpenRouter com teto (eu te guio); coletar o feedback |
| Fase 13 | Decisões de custo e região; conta de desenvolvedor da Google Play (taxa única); lista de 12 testadores |
| Fase 15 | Xcode completo e conta Apple Developer |

## Onde ficam as chaves
- **OpenRouter (desenvolvimento no Mac):** `.env.local` na raiz (ignorado pelo git) e, no app, o Keychain.
- **OpenRouter (celular):** Keystore do Android, colada pela pessoa no primeiro uso. No piloto, uma chave por pessoa com teto de gasto.
- **Servidor de IA (público):** chave do Pingo no SSM Parameter Store, nunca no app.
- **Chave de assinatura do APK/AAB:** fora do repositório, com cópia segura.
- **Nunca cole chaves no chat.**

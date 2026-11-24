# Requisitos: Pingo

App de celular (Android primeiro) que recebe o que você compartilha com ele (texto, foto, PDF, áudio, inclusive de conversas do WhatsApp), extrai datas, tarefas e responsáveis, pede confirmação e guarda numa agenda pessoal com lembretes.

Referência: vídeo "Muralito" (Hellena Aguiar, nov/2026). Mantemos o fluxo receber → "Entendi assim" → confirmar → lembrar. Trocamos "encaminhar para um número de WhatsApp" por **Compartilhar → Pingo**, que não depende da Meta. Removemos o contexto "filhos/família".

**Revisão de 23/11/2026:** o canal de bot de WhatsApp (relay na AWS + Meta Business) foi pausado. O código foi preservado e a pilha da AWS foi destruída (ver Apêndice B do design).

**Princípios**
1. **Local-first.** Dados, regras e lembretes ficam no aparelho. Não há site nem painel web.
2. **IA somente via OpenRouter**, escolhida por função em arquivo de configuração.
3. **Custo mínimo na AWS.** Hoje não há nada rodando lá. Quando houver (servidor de IA da fase pública), só serviços serverless pagos por uso (R13).
4. **Nada vira "confirmado" sem ação do dono.** Conteúdo de mensagens é dado, nunca instrução.

## Escopo

**Dentro (piloto):** app Android instalado por APK; Compartilhar → Pingo; conversa dentro do app; IA via OpenRouter com chave por pessoa e teto de gasto; confirmação por botões; agenda; lembretes por notificações do sistema (hora aproximada); contatos com delegação manual pelo WhatsApp do dono; backup e "apagar meus dados".
**Dentro (fase pública):** servidor de IA mínimo na AWS com cotas por usuário, plano gratuito com limite, publicação na Google Play. Assinatura vem depois.
**Depois:** iPhone, assinatura paga.
**Pausado:** bot de WhatsApp (Meta Business, relay na AWS).
**Fora:** painel web, leitura automática de notificações ou de grupos, sincronização entre dispositivos, multiusuário no mesmo aparelho.

## Glossário

- **Dono:** a pessoa que instala o Pingo e usa o aparelho.
- **Contato:** pessoa cadastrada pelo dono a quem itens podem ser passados.
- **Item:** unidade organizada (tarefa, evento, prazo, autorização, pagamento, info).
- **Proposta:** item extraído e ainda não confirmado (cartão "Entendi assim").
- **Compartilhar:** a opção do sistema Android (menu "Compartilhar" de qualquer app) que envia texto, imagem, PDF ou áudio ao Pingo.
- **Delegação manual:** o dono envia a mensagem ao contato pelo próprio WhatsApp (o Pingo só a deixa pronta) e marca "Confirmou".
- **Servidor de IA:** pequeno serviço serverless na AWS (fase pública) que recebe as chamadas de IA do app, aplica cotas e repassa ao OpenRouter com a chave do Pingo.

## Requisitos

### R1. Receber conteúdo de vários tipos
- R1.1 Texto, imagem (JPG/PNG), PDF e áudio são aceitos pelo menu Compartilhar de qualquer app; outros tipos geram resposta amigável de "não consigo ler isso".
- R1.2 Também é possível colar texto, anexar arquivo e gravar áudio dentro do app.
- R1.3 Áudio é enviado a um modelo multimodal (sem serviço separado de transcrição), inclusive notas de voz do WhatsApp (Ogg/Opus). A transcrição fica salva e visível em "Conferir o original".
- R1.4 Limites: 10 MB por arquivo, PDF até 20 páginas.
- R1.5 Conteúdo idêntico recebido de novo (mesmo resumo criptográfico do conteúdo) gera aviso "parece que já recebi isso" em vez de duplicar.
- R1.6 Compartilhar com o app fechado ou sem internet nunca perde o conteúdo: ele fica pendente e é processado quando o app abrir ou a internet voltar (ver R11.1).

### R2. Extrair itens estruturados
- R2.1 Uma mensagem pode gerar zero, um ou vários itens.
- R2.2 Cada item tem: tipo, título, resumo, quando (início/fim/dia inteiro/prazo), local, responsável, lembretes sugeridos.
- R2.3 Datas relativas são resolvidas pela data de recebimento e pelo fuso do dono (padrão America/Sao_Paulo).
- R2.4 Campo não encontrado aparece como "não informado" e nunca é inventado.
- R2.5 Se não há nada acionável, o app diz isso e não cria item.

### R3. Confirmar antes de salvar
- R3.1 Nada é salvo como confirmado sem ação explícita do dono.
- R3.2 O cartão oferece: Confirmar, Passar para [contato], Editar, Descartar, Ver original.
- R3.3 Editar aceita texto livre ("muda para 14h") e atualiza o cartão.
- R3.4 Propostas sem resposta expiram em 48 h; "pendentes" permite reabrir.

### R4. Agenda e consultas
- R4.1 Comandos e linguagem natural: "hoje", "amanhã", "semana", "pendentes", "o que tenho sexta?".
- R4.2 Respostas ordenadas por data, agrupadas por dia, com ícone por tipo.
- R4.3 Marcar item como feito ou cancelar.

### R5. Lembretes (notificações do sistema)
- R5.1 Lembretes padrão por tipo (evento: véspera às 20h e 1 h antes; prazo: 2 dias antes às 9h e no dia), calculados pelo código.
- R5.2 Cada lembrete é uma **notificação agendada no sistema**, que dispara com o app fechado. A hora é **aproximada** (tolerância de alguns minutos); o app não pede permissão de alarme exato.
- R5.3 O app reconcilia as notificações agendadas com o banco ao abrir, a cada mudança e depois que o aparelho reinicia.
- R5.4 Cada lembrete é entregue no máximo uma vez. Ao abrir o app, os lembretes vencidos aparecem também na conversa.
- R5.5 A notificação tem ações: Feito, Adiar 1 h, Amanhã 9h.
- R5.6 Ao editar, cancelar ou concluir um item, as notificações dele são atualizadas ou removidas.
- R5.7 A permissão de notificações é pedida com explicação. Sem ela, o app avisa de forma visível que os lembretes não vão disparar.
- R5.8 O texto da notificação é composto na hora de agendar (já considerando o horário do disparo).

### R6. Contatos e delegação manual
- R6.1 O dono cadastra contatos por nome e número.
- R6.2 "Passar para Renato" abre o WhatsApp do dono com a mensagem pronta para o contato (texto do cartão); o dono toca em enviar.
- R6.3 O item fica "aguardando confirmação do Renato". O dono marca **Confirmou** ou **Recusou**.
- R6.4 Se o contato não confirmar em 24 h (ou na véspera do item, o que vier primeiro), o Pingo avisa o dono para cobrar, com botão para reenviar.
- R6.5 O Pingo nunca envia mensagem a contatos por conta própria. Contatos não instalam nada nem dão permissão ao app.
- R6.6 Itens com responsável mostram o nome nos lembretes do dono.

### R7. Privacidade e consentimento
- R7.1 Dados do dono ficam no aparelho. No piloto não há servidor do Pingo; na fase pública o conteúdo passa pelo servidor de IA só durante a chamada e não é guardado nem registrado.
- R7.2 Consentimento explícito e versionado no primeiro uso; mudou o texto, todos aceitam de novo.
- R7.3 "Apagar meus dados" remove o banco local, arquivos temporários e chaves, e (na fase pública) o registro do dispositivo no servidor de IA.
- R7.4 Mídia compartilhada fica em disco só até ser processada.
- R7.5 Requisições à IA usam provedores que não retêm nem treinam com os dados (opção de privacidade do OpenRouter).
- R7.6 Chaves ficam no armazenamento seguro do sistema (Keystore no Android, Keychain no macOS), nunca em texto puro no banco.
- R7.7 Dados de contatos ficam só no aparelho. Mensagens a contatos saem pelo WhatsApp do dono, não pelo Pingo.

### R8. App com experiência de última geração
- R8.1 Android primeiro (APK). macOS continua como ambiente de desenvolvimento e uso. iPhone depois, com o mesmo código.
- R8.2 A conversa dentro do app reproduz o fluxo completo (texto, anexos, áudio gravado, botões, cartões, lembretes) e funciona também sem usar o Compartilhar.
- R8.3 Design despojado e alegre: fontes expressivas, ícones, cores vivas, microinterações.
- R8.4 Transições animadas entre estados e entre botões, cartões e telas.
- R8.5 Tema claro e escuro, acessível, respeita "reduzir movimento".
- R8.6 Painel de desenvolvedor (só em builds de desenvolvimento): relógio virtual, JSON da extração, custo por chamada, modelo usado.
- R8.7 Sem internet o app consulta e edita a agenda; a IA exige internet. O que for compartilhado sem internet fica pendente.
- R8.8 Interface de celular: áreas seguras da tela, teclado que não cobre o campo, botão voltar do Android, alvos de toque de pelo menos 48 dp.

### R9. Entrada pelo Compartilhar (Android)
- R9.1 O Pingo aparece no menu Compartilhar para texto, imagem, PDF e áudio.
- R9.2 Funciona com o app fechado (abertura a frio) e com o app já aberto.
- R9.3 Ao compartilhar, o app abre na conversa, mostra "organizando…" e depois o cartão.
- R9.4 Vários arquivos compartilhados de uma vez viram vários itens de entrada, processados em sequência.
- R9.5 O app não pede acesso geral a arquivos: usa só o acesso temporário que o próprio compartilhamento concede.

### R10. IA via OpenRouter, barata e configurável
- R10.1 Todas as chamadas de IA passam pelo OpenRouter.
- R10.2 Modelos são escolhidos por função (texto, imagem, PDF, áudio) em arquivo de configuração, com lista de alternativas em ordem de preferência.
- R10.3 Padrão: os modelos mais baratos que cumprem o requisito, validados pelo conjunto de mensagens de referência antes de adotar.
- R10.4 Cada chamada registra modelo, tokens e custo; há teto diário e mensal configurável.
- R10.5 Trocar de modelo não exige alterar código.
- R10.6 Comando de manutenção lista os modelos mais baratos por função, a partir do catálogo público do OpenRouter.
- R10.7 O provedor de IA é uma interface com URL base configurável (também usada para apontar ao servidor de IA do Pingo ou a um modelo local).
- R10.8 **Modo piloto:** cada pessoa usa uma chave própria do OpenRouter, criada com teto de gasto e entregue em particular, guardada no cofre do aparelho.
- R10.9 **Modo público:** o app chama o servidor de IA com um token de dispositivo; o servidor aplica cotas, restringe modelos e parâmetros e repassa ao OpenRouter.

### R11. Qualidade e operação
- R11.1 Falhas de IA, de rede ou fechamento do app nunca perdem o conteúdo do dono: a entrada é gravada como pendente antes de qualquer processamento e reprocessada depois, com aviso amigável.
- R11.2 Logs sem conteúdo de mensagens, locais e (quando houver) na nuvem.
- R11.3 O app exporta e importa backup em arquivo, usando o menu Compartilhar do sistema para exportar. O backup automático do Android é adotado se a validação mostrar que funciona.
- R11.4 Infraestrutura AWS, quando existir, é definida como código e reproduzível com um comando.
- R11.5 Alertas de custo e de abuso quando houver servidor.

### R12. Distribuição
- R12.1 Piloto: APK assinado, instalado direto nos aparelhos das pessoas convidadas.
- R12.2 Público: pacote AAB na Google Play, depois do teste fechado exigido a contas pessoais novas (12 testadores por 14 dias seguidos; conferir a regra vigente).
- R12.3 Política de privacidade em endereço público e formulário de segurança de dados preenchidos antes da publicação.

### R13. Custo mínimo na AWS
- R13.1 Sem servidor, nada na AWS. Estado atual: a pilha do relay foi destruída; resta só o preparo do CDK (alguns MB num bucket).
- R13.2 Quando houver servidor, só serviços serverless pagos por uso. Proibido: recursos de custo fixo (NAT Gateway, EC2, ECS, RDS, ElastiCache, balanceadores) e planos pagos sem necessidade comprovada.
- R13.3 Teto global diário de gasto com IA no servidor, com desligamento automático ao atingir; cota por usuário.
- R13.4 Orçamento mensal com alerta filtrado pela etiqueta `app=pingo`, mais alarmes de falha e de volume anormal.
- R13.5 Logs com retenção de até 14 dias e dados transitórios com expiração.
- R13.6 Meta de custo mensal por usuário definida antes de abrir ao público e acompanhada no piloto.

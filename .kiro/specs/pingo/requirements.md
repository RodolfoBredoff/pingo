# Requisitos: Pingo

Agente de WhatsApp que recebe mensagens encaminhadas (texto, foto, PDF, áudio), extrai datas, tarefas e responsáveis, pede confirmação e guarda numa agenda pessoal com lembretes.

Referência: vídeo "Muralito" (Hellena Aguiar, nov/2026). Mantemos o fluxo encaminhar → "Entendi assim" → confirmar → lembrar. Removemos o contexto "filhos/família".

**Princípio central: local-first.** Dados, regras de negócio e chamadas de IA ficam no app do usuário (PC ou smartphone). A nuvem (AWS) existe só para o que o WhatsApp obriga a ser público: receber o webhook e enviar lembretes quando o app está fechado. Não há site nem painel web.

## Escopo do MVP

**Dentro:** app local (desktop primeiro) com chat/simulador, agente com IA via OpenRouter, confirmação por botões, agenda, lembretes, contatos, relay mínimo na AWS para o WhatsApp.
**Fora:** painel web, leitura de grupos, sincronização entre dispositivos, pagamento, multiusuário (um dono por instalação).

## Glossário

- **Dono:** a pessoa que instala o Pingo e usa o número do WhatsApp dela como identidade.
- **Contato:** pessoa cadastrada pelo dono a quem itens podem ser atribuídos.
- **Item:** unidade organizada (tarefa, evento, prazo, autorização, pagamento, info).
- **Proposta:** item extraído e ainda não confirmado (cartão "Entendi assim").
- **Canal:** forma de falar com o agente: Simulador (dentro do app) ou WhatsApp (via relay).
- **Relay:** pequeno serviço na AWS que recebe o webhook do WhatsApp, guarda mensagens numa fila e agenda lembretes.
- **Dispositivo-casa:** o aparelho onde o app roda e onde ficam os dados.

## Requisitos

### R1. Receber mensagens de vários tipos
- R1.1 Texto, imagem (JPG/PNG), PDF e áudio são aceitos; outros tipos geram resposta amigável de "não consigo ler isso".
- R1.2 Áudio é enviado a um modelo multimodal (sem serviço separado de transcrição); a transcrição fica salva e visível em "Conferir o original".
- R1.3 Limites: 10 MB por arquivo, PDF até 20 páginas.
- R1.4 Mensagens duplicadas (mesmo id do canal) são processadas uma única vez.

### R2. Extrair itens estruturados
- R2.1 Uma mensagem pode gerar zero, um ou vários itens.
- R2.2 Cada item tem: tipo, título, resumo, quando (início/fim/dia inteiro/prazo), local, responsável, lembretes sugeridos.
- R2.3 Datas relativas são resolvidas pela data de recebimento e pelo fuso do dono (padrão America/Sao_Paulo).
- R2.4 Campo não encontrado aparece como "não informado" e nunca é inventado.
- R2.5 Se não há nada acionável, o agente diz isso e não cria item.

### R3. Confirmar antes de salvar
- R3.1 Nada é salvo como confirmado sem ação explícita do dono.
- R3.2 O cartão oferece: Confirmar, Passar para [contato], Editar, Descartar, Ver original.
- R3.3 Editar aceita texto livre ("muda para 14h") e atualiza o cartão.
- R3.4 Propostas sem resposta expiram em 48 h; "pendentes" permite reabrir.

### R4. Agenda e consultas
- R4.1 Comandos e linguagem natural: "hoje", "amanhã", "semana", "pendentes", "o que tenho sexta?".
- R4.2 Respostas ordenadas por data, agrupadas por dia, com ícone por tipo.
- R4.3 Marcar item como feito ou cancelar.

### R5. Lembretes
- R5.1 Lembretes padrão por tipo (evento: 1 dia antes às 20h e 1 h antes; prazo: 2 dias antes às 9h), ajustáveis.
- R5.2 **Com o app aberto:** o lembrete chega como notificação local e como mensagem no chat/WhatsApp.
- R5.3 **Com o app fechado:** o lembrete já está agendado na AWS e é enviado por WhatsApp no horário, sem depender do dispositivo.
- R5.4 Cada lembrete é entregue no máximo uma vez (idempotência entre local e nuvem).
- R5.5 Fora da janela de 24 h do WhatsApp o envio usa template aprovado.
- R5.6 Lembrete tem botões: Feito, Adiar 1 h, Adiar para amanhã.
- R5.7 Ao editar, cancelar ou concluir um item, os lembretes locais e da nuvem são atualizados ou removidos.

### R6. Contatos
- R6.1 O dono cadastra contatos por nome e número.
- R6.2 "Passar para Renato" envia uma oferta por WhatsApp; o contato aceita ou recusa por botão.
- R6.3 Só o dono e os contatos com opt-in conversam com o agente. Número desconhecido recebe uma única mensagem educada e é ignorado depois.
- R6.4 Contatos não têm agenda própria: respondem a ofertas e recebem lembretes dos itens que aceitaram.

### R7. Privacidade e consentimento
- R7.1 Dados do dono ficam no dispositivo; a nuvem guarda apenas o necessário de forma transitória (fila de entrada com expiração, agendamentos de lembrete, lista de números permitidos).
- R7.2 Mensagens na fila da nuvem expiram em até 7 dias e são apagadas após o dispositivo confirmar o recebimento.
- R7.3 Contato novo só recebe mensagens após opt-in explícito (mensagem de apresentação com botão "Aceito").
- R7.4 "Apagar meus dados" remove banco local, mídia local e tudo que existir na nuvem.
- R7.5 Mídia temporária na nuvem expira em até 24 h.
- R7.6 Requisições à IA usam provedores que não retêm nem treinam com os dados (opção de privacidade do OpenRouter).
- R7.7 Chaves ficam no armazenamento seguro do sistema (Keychain/Credential Manager/Keystore), nunca em texto puro no banco.

### R8. App local com experiência de última geração
- R8.1 App instalável para macOS, Windows e Linux; smartphone (iOS/Android) na etapa seguinte com o mesmo código.
- R8.2 O Simulador é um canal embutido no app: reproduz o fluxo completo (texto, anexos, áudio gravado, botões, cartões, lembretes) sem WhatsApp e sem AWS.
- R8.3 Design despojado e alegre: fontes expressivas, ícones, cores vivas, microinterações.
- R8.4 Transições animadas entre estados e entre botões, cartões e telas.
- R8.5 Tema claro e escuro, acessível, respeita "reduzir movimento".
- R8.6 Painel de desenvolvedor: relógio virtual, JSON da extração, custo por chamada, modelo usado.
- R8.7 Funciona sem internet para consultar e editar a agenda; extração por IA e WhatsApp exigem internet.
- R8.8 No desktop, o app pode ficar na bandeja e iniciar com o sistema para continuar processando mensagens.

### R9. Canal WhatsApp via relay
- R9.1 Relay na AWS valida a assinatura do webhook da Meta e coloca a mensagem numa fila.
- R9.2 O app consulta a fila por long polling autenticado e confirma o recebimento.
- R9.3 Mensagens de saída (texto, botões até 3, listas, templates) passam pelo relay, que guarda as credenciais da Meta.
- R9.4 Quando o app está offline, o relay responde uma única vez "Recebi! Organizo assim que o Pingo abrir" (no máximo 1 a cada 10 minutos).
- R9.5 O relay decide entre mensagem livre e template conforme a janela de 24 h.
- R9.6 Mídia é baixada pelo relay para armazenamento temporário e entregue ao app por link temporário.
- R9.7 Opcional: cartão enviado como imagem com a identidade visual.

### R10. IA via OpenRouter, barata e configurável
- R10.1 Todas as chamadas de IA passam pelo OpenRouter com uma única chave.
- R10.2 Modelos são escolhidos por função (texto, imagem, PDF, áudio) em arquivo de configuração, com lista de alternativas em ordem de preferência.
- R10.3 Padrão: os modelos mais baratos que cumprem o requisito, validados pelo conjunto de mensagens de referência antes de adotar.
- R10.4 Cada chamada registra modelo, tokens e custo; há teto diário e mensal configurável.
- R10.5 Trocar de modelo não exige alterar código.
- R10.6 Comando de manutenção lista os modelos mais baratos por função, a partir do catálogo público do OpenRouter.
- R10.7 O provedor de IA é uma interface com URL base configurável, permitindo apontar para um modelo local (ex.: Ollama) no futuro.

### R11. Qualidade e operação
- R11.1 Falhas de IA ou canal nunca perdem a mensagem do dono: reprocessamento e aviso amigável.
- R11.2 Logs sem conteúdo de mensagens por padrão, locais e na nuvem.
- R11.3 O app exporta e importa backup do banco em arquivo (dados só no dispositivo exigem isso).
- R11.4 Infraestrutura AWS definida como código e reproduzível com um comando.
- R11.5 Alerta de custo e de falha de lembrete na AWS.

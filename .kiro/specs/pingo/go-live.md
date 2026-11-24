# Checklist: Pingo no Android

Confira valores, limites e preços na documentação oficial da Google, da AWS e do OpenRouter no dia de executar. Isso muda com frequência.

## 1. Contas e acessos
- [ ] Conta OpenRouter com saldo pequeno; **uma chave por pessoa do piloto, com teto de gasto**
- [ ] Privacidade do OpenRouter: bloquear provedores que retêm ou treinam com dados (já é o padrão do app)
- [ ] Celular Android do desenvolvedor com Depuração USB
- [ ] Chave de assinatura do APK criada e guardada fora do repositório, com cópia segura
- [ ] (Público) Conta de desenvolvedor da Google Play (taxa única)
- [ ] (Público) AWS: perfil SSO `publishing` funcionando (`aws sts get-caller-identity`)

## 2. Ambiente de desenvolvimento
- [ ] `pnpm android:doctor` todo verde
- [ ] Os 7 protótipos da Fase 6 concluídos e registrados em `design.md`

## 3. Piloto (APK direto)
- [ ] `pnpm tauri android build --apk` gera um APK assinado
- [ ] Instalação por arquivo funciona em pelo menos 2 marcas de celular
- [ ] Compartilhar funciona de WhatsApp com foto, PDF, nota de voz e texto, com o app fechado e aberto
- [ ] Lembretes disparam com o app fechado, também depois de reiniciar o celular
- [ ] Permissões explicadas na primeira abertura (notificações e microfone)
- [ ] Guia de uma página entregue com o APK
- [ ] Consentimento e "apagar meus dados" testados no aparelho
- [ ] Backup exportado e restaurado em teste
- [ ] Custo por pessoa e por semana medido; pontualidade dos lembretes medida

## 4. Público
- [ ] Servidor de IA (`apps/ai-server`) implantado com **teto global diário que desliga sozinho**
- [ ] Nenhum recurso de custo fixo na AWS (sem NAT, EC2, ECS, RDS, ElastiCache)
- [ ] Orçamento mensal filtrado por `app=pingo` e alarmes ativos; e-mail dos alarmes confirmado
- [ ] Medição de custo com tráfego real feita **antes** de abrir
- [ ] Limite do plano gratuito definido a partir dessa medição
- [ ] Política de privacidade publicada em endereço público; formulário de segurança de dados preenchido
- [ ] Teste fechado na Google Play com 12 testadores por 14 dias seguidos
- [ ] AAB assinado, ficha da loja, ícones e capturas de tela
- [ ] Nível de API exigido pela Play conferido no dia

## 5. Qualidade
- [ ] Piloto de pelo menos uma semana concluído
- [ ] Erros de extração revisados; modelos ajustados com mensagens reais
- [ ] Revisão de acessibilidade e de "reduzir movimento" no aparelho

## 6. Pós-lançamento (primeira semana)
- [ ] Acompanhar custo diário de IA e custo da AWS
- [ ] Acompanhar confirmação × descarte das propostas
- [ ] Acompanhar falhas de lembrete e pedidos negados por cota
- [ ] Decidir sobre assinatura e sobre o iPhone

---

## Apêndice: checklist do canal WhatsApp via Meta (PAUSADO)
Guardado do plano anterior. Só volta a valer se o canal de bot for retomado (Fase 16 de `tasks.md`).


Confira valores e preços da Meta, da AWS e do OpenRouter no dia. A pilha da AWS foi destruída em 23/11/2026; os itens de AWS abaixo valem só se o relay for reimplantado.

### 1. Contas e acessos
- [ ] Conta OpenRouter com saldo pequeno e limite de gasto; chave criada para o Pingo
- [ ] Privacidade do OpenRouter: bloquear provedores que retêm ou treinam com dados
- [x] AWS: perfil SSO `publishing` (conta 025843049355), região `sa-east-1` confirmada
- [ ] AWS: orçamento mensal com alerta (AWS Budgets). A conta `publishing` é compartilhada: ative a tag de custo `app` e filtre o orçamento por ela
- [ ] Conta Meta Business criada e verificada
- [ ] App na Meta for Developers com produto WhatsApp
- [ ] Número de telefone dedicado (não ativo no WhatsApp comum)
- [ ] Token permanente (usuário do sistema) e app secret guardados só no SSM

### 2. AWS
- [x] `cdk bootstrap` executado
- [x] `cdk deploy` da pilha do relay sem erros
- [ ] Credenciais Meta gravadas com `pnpm relay:set-secret`
- [x] URL do API Gateway anotada: `https://r5ydartzwh.execute-api.sa-east-1.amazonaws.com` (webhook em `/wa/webhook`)
- [x] Bucket S3 privado com lifecycle de 1 dia
- [x] Fila SQS com DLQ e retenção definida
- [x] Retenção de logs em 14 dias; nenhum log com texto de mensagem
- [ ] Alarmes de falha ativos (criados); falta assinar o e-mail do tópico `PingoRelay-Alerts`
- [x] Teste de pareamento com o relay (`pnpm relay:smoke`); o pareamento pelo app é da Fase 6

### 3. WhatsApp
- [ ] Webhook configurado (URL do relay + token de verificação); campo `messages` assinado
- [ ] Assinatura `X-Hub-Signature-256` validada em teste real
- [ ] Modelos aprovados (4): `boas_vindas`, `lembrete_item`, `lembrete_contato`, `oferta_responsabilidade` (textos abaixo)
- [ ] Nome de exibição e foto do negócio definidos
- [ ] Teste: texto, imagem, PDF, áudio, botões, lista, template
- [ ] Teste: app fechado → "Recebi!" → abrir app → proposta chega
- [ ] Teste: lembrete com app fechado chega no horário
- [ ] Teste: número desconhecido é ignorado em silêncio (decisão R6.3; verificado no relay, falta com a Meta real)

### 4. App
- [ ] Chave OpenRouter gravada no keychain pelo app
- [ ] Modelos finais definidos em `models.json` com base no conjunto de referência
- [ ] Tetos diário e mensal de custo configurados
- [ ] Backup exportado e restaurado com sucesso em teste
- [ ] "Apagar meus dados" testado (local e nuvem)
- [ ] App na bandeja com início automático (desktop)
- [ ] Texto de consentimento e política de privacidade revisados

### 5. Qualidade
- [ ] Piloto de uma semana concluído
- [ ] Erros de extração revisados; modelos ajustados
- [ ] Revisão de acessibilidade e de reduzir movimento

### 6. Pós-lançamento (primeira semana)
- [ ] Acompanhar custo diário de IA e custo AWS
- [ ] Acompanhar confirmação vs. descarte das propostas
- [ ] Acompanhar falhas de lembrete e mensagens presas na DLQ
- [ ] Decidir se vale ir para o smartphone ou criar painel web

### Modelos de mensagem para submeter à Meta
Idioma: português (Brasil). Categoria sugerida: Utilidade. Os nomes são exatos (o relay só aceita estes). Variáveis em ordem; o app nunca manda quebra de linha dentro delas. Confira as regras de aprovação no painel da Meta no dia.

| Nome | Corpo | Botões de resposta rápida |
|---|---|---|
| `oferta_responsabilidade` | `Oi, {{1}}! Aqui é o Pingo, assistente de {{2}}. Ele(a) quer passar para você: {{3}} ({{4}}). Pode ficar com essa?` | `Aceito`, `Não posso` |
| `lembrete_item` | `🔔 Lembrete: {{1}} ({{2}})` | `Feito ✅`, `Adiar 1 h`, `Amanhã 9h` |
| `lembrete_contato` | `🔔 Lembrete: {{1}} ({{2}}). {{3}} passou isso para você.` | nenhum |
| `boas_vindas` | `Oi, {{1}}! Eu sou o Pingo, assistente de {{2}}. Posso te mandar recados e lembretes?` | `Pode`, `Agora não` |

Os botões de resposta rápida levam um valor interno que o app envia (por exemplo `offer_yes:<id>`); na Meta basta criar os botões com o texto acima.


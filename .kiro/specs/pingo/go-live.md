# Checklist de go-live: Pingo

Confira valores, limites e preços na documentação oficial da Meta, da AWS e do OpenRouter no dia de executar. Isso muda com frequência.

## 1. Contas e acessos
- [ ] Conta OpenRouter com saldo pequeno e limite de gasto; chave criada para o Pingo
- [ ] Privacidade do OpenRouter: bloquear provedores que retêm ou treinam com dados
- [x] AWS: perfil SSO `publishing` (conta 025843049355), região `sa-east-1` confirmada
- [ ] AWS: orçamento mensal com alerta (AWS Budgets). A conta `publishing` é compartilhada: ative a tag de custo `app` e filtre o orçamento por ela
- [ ] Conta Meta Business criada e verificada
- [ ] App na Meta for Developers com produto WhatsApp
- [ ] Número de telefone dedicado (não ativo no WhatsApp comum)
- [ ] Token permanente (usuário do sistema) e app secret guardados só no SSM

## 2. AWS
- [x] `cdk bootstrap` executado
- [x] `cdk deploy` da pilha do relay sem erros
- [ ] Credenciais Meta gravadas com `pnpm relay:set-secret`
- [x] URL do API Gateway anotada: `https://r5ydartzwh.execute-api.sa-east-1.amazonaws.com` (webhook em `/wa/webhook`)
- [x] Bucket S3 privado com lifecycle de 1 dia
- [x] Fila SQS com DLQ e retenção definida
- [x] Retenção de logs em 14 dias; nenhum log com texto de mensagem
- [ ] Alarmes de falha ativos (criados); falta assinar o e-mail do tópico `PingoRelay-Alerts`
- [x] Teste de pareamento com o relay (`pnpm relay:smoke`); o pareamento pelo app é da Fase 6

## 3. WhatsApp
- [ ] Webhook configurado (URL do relay + token de verificação); campo `messages` assinado
- [ ] Assinatura `X-Hub-Signature-256` validada em teste real
- [ ] Templates aprovados: `boas_vindas`, `lembrete_item`, `oferta_responsabilidade`
- [ ] Nome de exibição e foto do negócio definidos
- [ ] Teste: texto, imagem, PDF, áudio, botões, lista, template
- [ ] Teste: app fechado → "Recebi!" → abrir app → proposta chega
- [ ] Teste: lembrete com app fechado chega no horário
- [ ] Teste: número desconhecido é ignorado em silêncio (decisão R6.3; verificado no relay, falta com a Meta real)

## 4. App
- [ ] Chave OpenRouter gravada no keychain pelo app
- [ ] Modelos finais definidos em `models.json` com base no conjunto de referência
- [ ] Tetos diário e mensal de custo configurados
- [ ] Backup exportado e restaurado com sucesso em teste
- [ ] "Apagar meus dados" testado (local e nuvem)
- [ ] App na bandeja com início automático (desktop)
- [ ] Texto de consentimento e política de privacidade revisados

## 5. Qualidade
- [ ] Piloto de uma semana concluído
- [ ] Erros de extração revisados; modelos ajustados
- [ ] Revisão de acessibilidade e de reduzir movimento

## 6. Pós-lançamento (primeira semana)
- [ ] Acompanhar custo diário de IA e custo AWS
- [ ] Acompanhar confirmação vs. descarte das propostas
- [ ] Acompanhar falhas de lembrete e mensagens presas na DLQ
- [ ] Decidir se vale ir para o smartphone ou criar painel web

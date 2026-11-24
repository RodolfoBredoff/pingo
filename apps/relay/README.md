# Relay do WhatsApp (PAUSADO)

Relay na AWS que fala com a WhatsApp Cloud API da Meta: webhook assinado, fila FIFO, rotas do dispositivo, lembretes no EventBridge Scheduler e alarmes. **Está pausado desde 23/11/2026.** O Pingo passou a receber conteúdo pelo menu Compartilhar do Android (ver `.kiro/specs/pingo/design.md`).

## Estado
- **Nada está implantado.** A pilha `PingoRelay` foi destruída e os parâmetros de teste do SSM, apagados. Resta apenas o `CDKToolkit` (preparo do CDK: um bucket com ~5 MB), que custa centavos e permite reimplantar em minutos.
- O código está completo e testado.
- Conta: `publishing` (025843049355), região `sa-east-1`. O CDK e os scripts recusam qualquer outra conta.

## Como retomar
```
aws sso login --profile publishing
pnpm relay:deploy                    # cria a pilha (lê PINGO_ALERT_EMAIL do .env.local)
pnpm relay:set-secret verify-token --generate
pnpm relay:set-secret app-secret     # os valores são digitados sem aparecer na tela
pnpm relay:set-secret access-token
pnpm relay:set-secret phone-number-id
pnpm relay:pair-code                 # código de uso único para o app
```
Depois de reimplantar, o endereço muda; copie `ApiUrl` e `WebhookUrl` da saída do deploy.

## Para destruir de novo (custo zero)
```
AWS_PROFILE=publishing pnpm --filter @pingo/relay exec cdk destroy --force
AWS_PROFILE=publishing aws ssm delete-parameters --region sa-east-1 --names /pingo/meta/access-token /pingo/meta/app-secret /pingo/meta/phone-number-id /pingo/meta/verify-token
```

## Verificação (sem AWS, sem custo)
- `pnpm relay:test`: handlers com AWS e Meta em memória.
- `pnpm --filter @pingo/relay test:channel`: relay + `RelayChannel` + orquestrador de ponta a ponta.
- `pnpm relay:smoke [--fire]`: chamadas reais à AWS (**só com a pilha implantada**; apaga tudo no fim).

## Reuso
A estrutura (CDK, token por dispositivo guardado como hash, limites de taxa, alarmes, roteiro de teste) é a base do servidor de IA da fase pública (design, Apêndice A), com a regra de custo mínimo.

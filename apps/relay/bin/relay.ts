#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { RelayStack } from '../lib/relay-stack'

const app = new cdk.App()
const account = String(app.node.tryGetContext('pingoAccount'))
const region = String(app.node.tryGetContext('pingoRegion'))

// Trava de segurança: o Pingo só vive nesta conta. Se o perfil ativo for outro, para antes de criar qualquer coisa.
const active = process.env.CDK_DEFAULT_ACCOUNT
if (active && active !== account) {
  throw new Error(
    `Conta errada: o perfil atual é ${active}, mas o Pingo é da conta ${account}. ` +
      `Use: AWS_PROFILE=publishing pnpm --filter @pingo/relay deploy`,
  )
}

new RelayStack(app, 'PingoRelay', {
  env: { account, region },
  alertEmail: app.node.tryGetContext('alertEmail') as string | undefined,
  description: 'Pingo: relay do WhatsApp (webhook, fila, lembretes). Sem site, só API.',
})

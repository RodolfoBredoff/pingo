import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'

export const STACK = 'PingoRelay'
const ctx = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'cdk.json'), 'utf8')) as {
  context: { pingoAccount: string; pingoRegion: string }
}
export const ACCOUNT = ctx.context.pingoAccount
export const REGION = ctx.context.pingoRegion

// O SDK lê a região daqui, antes de qualquer cliente ser criado.
process.env.AWS_REGION = REGION
process.env.AWS_DEFAULT_REGION = REGION

/** Para antes de qualquer coisa se o perfil ativo não for a conta do Pingo. */
export async function assertAccount(): Promise<void> {
  const id = await new STSClient({}).send(new GetCallerIdentityCommand({}))
  if (id.Account !== ACCOUNT) {
    throw new Error(
      `Conta errada: ${id.Account}. O Pingo é da conta ${ACCOUNT}. Rode com AWS_PROFILE=publishing (aws sso login --profile publishing).`,
    )
  }
}

export async function stackOutputs(): Promise<Record<string, string>> {
  const r = await new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName: STACK }))
  const out: Record<string, string> = {}
  for (const o of r.Stacks?.[0]?.Outputs ?? [])
    if (o.OutputKey && o.OutputValue) out[o.OutputKey] = o.OutputValue
  return out
}

// Gera um código de pareamento de uso único (10 min) para ligar o app ao relay.
// Uso: pnpm relay:pair-code
import { createHash, randomInt } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { assertAccount, stackOutputs } from './lib/aws'

// Sem 0/O/1/I/L para ninguém errar ao copiar.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newPairCode(): string {
  const chars = Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]!)
  return [0, 4, 8, 12, 16].map((i) => chars.slice(i, i + 4).join('')).join('-')
}

export const hashCode = (code: string) =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex')

if (import.meta.main) {
  await assertAccount()
  const { TableName } = await stackOutputs()
  if (!TableName) throw new Error('Stack PingoRelay não encontrada. Rode o deploy primeiro.')
  const code = newPairCode()
  const expiresMs = Date.now() + 10 * 60_000
  await DynamoDBDocumentClient.from(new DynamoDBClient({})).send(
    new PutCommand({
      TableName,
      Item: { pk: 'PAIR', sk: hashCode(code), expiresMs, ttl: Math.floor(expiresMs / 1000) + 3600 },
    }),
  )
  console.log(`Código de pareamento (vale 10 minutos, uso único):\n\n  ${code}\n`)
}

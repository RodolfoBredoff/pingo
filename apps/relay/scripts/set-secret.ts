// Grava uma credencial da Meta no SSM Parameter Store (SecureString) sem expô-la.
// Uso: pnpm relay:set-secret <app-secret|access-token|phone-number-id|verify-token> [--generate]
// O valor é digitado sem eco; nunca vai em argumento de linha de comando, histórico ou log.
import { randomBytes } from 'node:crypto'
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { assertAccount } from './lib/aws'

const NAMES = ['app-secret', 'access-token', 'phone-number-id', 'verify-token'] as const
const name = process.argv[2]
const generate = process.argv.includes('--generate')

if (!name || !NAMES.includes(name as (typeof NAMES)[number])) {
  console.error(`Uso: pnpm relay:set-secret <${NAMES.join('|')}> [--generate]`)
  process.exit(1)
}

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error('Rode num terminal interativo (o valor é digitado sem eco).')
  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  return new Promise((resolve) => {
    let buf = ''
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          return resolve(buf)
        }
        if (c === '\u0003') process.exit(130)
        if (c === '\u007f') buf = buf.slice(0, -1)
        else buf += c
      }
    }
    process.stdin.on('data', onData)
  })
}

await assertAccount()
let value: string
if (generate) {
  if (name !== 'verify-token') throw new Error('--generate só vale para verify-token.')
  value = randomBytes(24).toString('base64url')
} else {
  value = (await readHidden(`Valor de ${name} (não aparece ao digitar): `)).trim()
}
if (!value) throw new Error('Valor vazio; nada foi gravado.')

await new SSMClient({}).send(
  new PutParameterCommand({
    Name: `/pingo/meta/${name}`,
    Value: value,
    Type: 'SecureString',
    Overwrite: true,
    Description: 'Pingo: credencial da Meta (WhatsApp Cloud API)',
  }),
)
console.log(`✅ /pingo/meta/${name} gravado como SecureString.`)
if (generate) {
  console.log(`\nToken de verificação (cole no painel da Meta, em "Verificar token"):\n${value}`)
}

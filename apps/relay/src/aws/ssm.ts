import { GetParameterCommand, ParameterNotFound, SSMClient } from '@aws-sdk/client-ssm'
import type { SecretName, Secrets } from '../ports'

const TTL_MS = 5 * 60 * 1000

/**
 * Lê as credenciais da Meta do Parameter Store (SecureString) e guarda em memória por 5 minutos.
 * Nunca registra o valor.
 */
export function createSsmSecrets(prefix: string, client = new SSMClient({})): Secrets {
  const cache = new Map<SecretName, { value: string | undefined; at: number }>()
  return {
    async get(name) {
      const hit = cache.get(name)
      if (hit && Date.now() - hit.at < TTL_MS) return hit.value
      let value: string | undefined
      try {
        const r = await client.send(
          new GetParameterCommand({ Name: `${prefix}/meta/${name}`, WithDecryption: true }),
        )
        value = r.Parameter?.Value
      } catch (e) {
        if (!(e instanceof ParameterNotFound)) throw e
      }
      cache.set(name, { value, at: Date.now() })
      return value
    },
  }
}

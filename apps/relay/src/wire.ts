import { createDynamoDb } from './aws/dynamo'
import { createEventBridgeScheduler } from './aws/scheduler'
import { createS3Files } from './aws/s3'
import { createSqsQueue } from './aws/sqs'
import { createSsmSecrets } from './aws/ssm'
import { createLogger } from './log'
import type { Deps, Scheduler } from './ports'
import { createWaClient } from './wa/client'

const env = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new Error(`variável de ambiente ausente: ${name}`)
  return v
}

/** Só as Lambdas que agendam têm essas variáveis; as outras nunca chegam a usá-lo. */
function lazyScheduler(): Scheduler {
  let real: Scheduler | undefined
  const get = () =>
    (real ??= createEventBridgeScheduler({
      group: env('SCHEDULER_GROUP'),
      targetArn: env('SEND_REMINDER_ARN'),
      roleArn: env('SCHEDULER_ROLE_ARN'),
      deadLetterArn: env('SCHEDULER_DLQ_ARN'),
    }))
  return {
    upsert: (s) => get().upsert(s),
    remove: (id) => get().remove(id),
    removeAll: () => get().removeAll(),
  }
}

let cached: Deps | undefined

/** Monta as dependências reais uma vez por instância da Lambda. */
export function getDeps(): Deps {
  if (cached) return cached
  const secrets = createSsmSecrets(env('SSM_PREFIX'))
  cached = {
    db: createDynamoDb(env('TABLE_NAME')),
    queue: createSqsQueue(env('QUEUE_URL')),
    secrets,
    files: createS3Files(env('BUCKET_NAME')),
    scheduler: lazyScheduler(),
    wa: createWaClient({
      secrets,
      version: process.env.GRAPH_API_VERSION,
      baseUrl: process.env.GRAPH_BASE_URL,
    }),
    clock: () => new Date(),
    log: createLogger('relay'),
  }
  return cached
}

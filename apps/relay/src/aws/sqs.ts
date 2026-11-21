import {
  DeleteMessageBatchCommand,
  PurgeQueueInProgress,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs'
import type { Queue } from '../ports'

export function createSqsQueue(queueUrl: string, client = new SQSClient({})): Queue {
  return {
    async send(body, dedupId, groupId) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: body,
          MessageDeduplicationId: dedupId.slice(0, 128),
          MessageGroupId: groupId.slice(0, 128),
        }),
      )
    },
    async receive(max, waitSec, visibilitySec) {
      const r = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: max,
          WaitTimeSeconds: waitSec,
          VisibilityTimeout: visibilitySec,
        }),
      )
      return (r.Messages ?? []).map((m) => ({ receipt: m.ReceiptHandle ?? '', body: m.Body ?? '' }))
    },
    async delete(receipts) {
      const r = await client.send(
        new DeleteMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: receipts.map((h, i) => ({ Id: String(i), ReceiptHandle: h })),
        }),
      )
      return r.Successful?.length ?? 0
    },
    async purge() {
      try {
        await client.send(new PurgeQueueCommand({ QueueUrl: queueUrl }))
      } catch (e) {
        // Só se pode limpar a cada 60 s; se já está limpando, o objetivo está cumprido.
        if (!(e instanceof PurgeQueueInProgress)) throw e
      }
    },
  }
}

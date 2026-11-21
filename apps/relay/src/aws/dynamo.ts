import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type { Db, DbItem } from '../ports'

/** Partições usadas (ver design.md §5). `clear` percorre todas, então não precisa de Scan. */
export const PARTITIONS = ['DEVICE', 'ALLOW', 'WINDOW', 'IDEMP', 'REMINDER', 'AUTOREPLY', 'PAIR']

export function createDynamoDb(table: string, client?: DynamoDBDocumentClient): Db {
  const doc =
    client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    })

  const conditional = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn()
      return true
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false
      throw e
    }
  }

  async function query(pk: string): Promise<DbItem[]> {
    const out: DbItem[] = []
    let key: Record<string, unknown> | undefined
    do {
      const r = await doc.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ConsistentRead: true,
          ExclusiveStartKey: key,
        }),
      )
      out.push(...((r.Items ?? []) as DbItem[]))
      key = r.LastEvaluatedKey
    } while (key)
    return out
  }

  return {
    async get(pk, sk) {
      const r = await doc.send(
        new GetCommand({ TableName: table, Key: { pk, sk }, ConsistentRead: true }),
      )
      return r.Item as DbItem | undefined
    },
    async put(item) {
      await doc.send(new PutCommand({ TableName: table, Item: item }))
    },
    putIfAbsent: (item) =>
      conditional(() =>
        doc.send(
          new PutCommand({
            TableName: table,
            Item: item,
            ConditionExpression: 'attribute_not_exists(pk)',
          }),
        ),
      ),
    claimSlot: (pk, sk, nowMs, durationMs) =>
      conditional(() =>
        doc.send(
          new PutCommand({
            TableName: table,
            Item: {
              pk,
              sk,
              untilMs: nowMs + durationMs,
              ttl: Math.floor((nowMs + durationMs) / 1000) + 3600,
            },
            ConditionExpression: 'attribute_not_exists(pk) OR untilMs < :now',
            ExpressionAttributeValues: { ':now': nowMs },
          }),
        ),
      ),
    async update(pk, sk, attrs) {
      const names: Record<string, string> = {}
      const values: Record<string, unknown> = {}
      const sets = Object.entries(attrs).map(([k, v], i) => {
        names[`#a${i}`] = k
        values[`:v${i}`] = v
        return `#a${i} = :v${i}`
      })
      await conditional(() =>
        doc.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk, sk },
            UpdateExpression: `SET ${sets.join(', ')}`,
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          }),
        ),
      )
    },
    async delete(pk, sk) {
      await doc.send(new DeleteCommand({ TableName: table, Key: { pk, sk } }))
    },
    query,
    async clear() {
      let n = 0
      for (const pk of PARTITIONS) {
        const items = await query(pk)
        for (let i = 0; i < items.length; i += 25) {
          const chunk = items.slice(i, i + 25)
          await doc.send(
            new BatchWriteCommand({
              RequestItems: {
                [table]: chunk.map((it) => ({ DeleteRequest: { Key: { pk: it.pk, sk: it.sk } } })),
              },
            }),
          )
          n += chunk.length
        }
      }
      return n
    },
  }
}

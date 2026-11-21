import {
  ConflictException,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ListSchedulesCommand,
  ResourceNotFoundException,
  SchedulerClient,
  UpdateScheduleCommand,
  type CreateScheduleCommandInput,
} from '@aws-sdk/client-scheduler'
import type { Scheduler } from '../ports'

export interface SchedulerConfig {
  group: string
  targetArn: string
  roleArn: string
  deadLetterArn: string
}

export const scheduleName = (id: string) => `pingo-rem-${id}`

/** Um agendamento único por lembrete: dispara uma vez e se apaga sozinho. */
export function createEventBridgeScheduler(
  cfg: SchedulerConfig,
  client = new SchedulerClient({}),
): Scheduler {
  const input = (id: string, at: string): CreateScheduleCommandInput => ({
    Name: scheduleName(id),
    GroupName: cfg.group,
    // `at()` não aceita fração de segundo nem "Z": UTC com precisão de segundos.
    ScheduleExpression: `at(${at.slice(0, 19)})`,
    ScheduleExpressionTimezone: 'UTC',
    FlexibleTimeWindow: { Mode: 'OFF' },
    ActionAfterCompletion: 'DELETE',
    Target: {
      Arn: cfg.targetArn,
      RoleArn: cfg.roleArn,
      Input: JSON.stringify({ id }),
      RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 },
      DeadLetterConfig: { Arn: cfg.deadLetterArn },
    },
  })

  const remove = async (id: string) => {
    try {
      await client.send(new DeleteScheduleCommand({ Name: scheduleName(id), GroupName: cfg.group }))
    } catch (e) {
      if (!(e instanceof ResourceNotFoundException)) throw e
    }
  }

  return {
    async upsert({ id, at }) {
      try {
        await client.send(new CreateScheduleCommand(input(id, at)))
      } catch (e) {
        if (!(e instanceof ConflictException)) throw e
        await client.send(new UpdateScheduleCommand(input(id, at)))
      }
    },
    remove,
    async removeAll() {
      let n = 0
      let token: string | undefined
      do {
        const r = await client.send(
          new ListSchedulesCommand({ GroupName: cfg.group, NextToken: token }),
        )
        for (const s of r.Schedules ?? []) {
          if (s.Name) {
            await client.send(new DeleteScheduleCommand({ Name: s.Name, GroupName: cfg.group }))
            n++
          }
        }
        token = r.NextToken
      } while (token)
      return n
    },
  }
}

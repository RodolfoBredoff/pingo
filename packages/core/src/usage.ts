import { eq, gte, sql } from 'drizzle-orm'
import type { UsageEvent } from './ai/extractor'
import type { PingoDb } from './db/client'
import { settings, usage } from './db/schema'
import { startOfLocalDayUtc, startOfLocalMonthUtc } from './time'

/** Custo e tetos de IA (R10.4). Valores em dólares, como o OpenRouter cobra. */

export interface BudgetLimits {
  dailyUsd: number
  monthlyUsd: number
}

export class BudgetExceededError extends Error {
  constructor(
    readonly scope: 'daily' | 'monthly',
    readonly limitUsd: number,
    readonly spentUsd: number,
  ) {
    super(`Teto ${scope === 'daily' ? 'diário' : 'mensal'} de IA atingido.`)
    this.name = 'BudgetExceededError'
  }
}

export async function recordUsage(db: PingoDb, e: UsageEvent, now: Date): Promise<void> {
  await db.insert(usage).values({
    id: crypto.randomUUID(),
    at: now.toISOString(),
    role: e.role,
    model: e.model,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    costUsd: e.costUsd,
  })
}

export async function spentSince(db: PingoDb, sinceIso: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${usage.costUsd}), 0)` })
    .from(usage)
    .where(gte(usage.at, sinceIso))
  return Number(rows[0]?.total ?? 0)
}

export interface UsageByRole {
  /** Função da IA (`text`, `vision`, `pdf`, `audio`). */
  role: string
  calls: number
  avgInputTokens: number
  avgOutputTokens: number
  totalUsd: number
  avgUsd: number
}

/**
 * Custo médio por tipo de chamada, para medir no piloto quanto cada extração custa (go-live,
 * Apêndice A). Só números: nada do conteúdo das mensagens entra na tabela `usage`.
 */
export async function usageByRole(db: PingoDb): Promise<UsageByRole[]> {
  const rows = await db
    .select({
      role: usage.role,
      calls: sql<number>`count(*)`,
      avgIn: sql<number>`coalesce(avg(${usage.inputTokens}), 0)`,
      avgOut: sql<number>`coalesce(avg(${usage.outputTokens}), 0)`,
      total: sql<number>`coalesce(sum(${usage.costUsd}), 0)`,
    })
    .from(usage)
    .groupBy(usage.role)
  return rows
    .map((r) => {
      const calls = Number(r.calls)
      const total = Number(r.total)
      return {
        role: r.role,
        calls,
        avgInputTokens: Math.round(Number(r.avgIn)),
        avgOutputTokens: Math.round(Number(r.avgOut)),
        totalUsd: total,
        avgUsd: calls > 0 ? total / calls : 0,
      }
    })
    .sort((a, b) => b.totalUsd - a.totalUsd)
}

/** Tetos do usuário (tabela settings) sobrepõem os padrões do models.json. */
export async function readBudgetLimits(db: PingoDb, defaults: BudgetLimits): Promise<BudgetLimits> {
  const read = async (key: string, fallback: number) => {
    const row = await db.select().from(settings).where(eq(settings.key, key)).get()
    const n = row ? Number(row.value) : NaN
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  return {
    dailyUsd: await read('cap_daily_usd', defaults.dailyUsd),
    monthlyUsd: await read('cap_monthly_usd', defaults.monthlyUsd),
  }
}

/** Lança BudgetExceededError se o gasto do dia ou do mês já passou do teto. */
export async function assertWithinBudget(
  db: PingoDb,
  now: Date,
  tz: string,
  defaults: BudgetLimits,
): Promise<void> {
  const limits = await readBudgetLimits(db, defaults)
  const day = await spentSince(db, startOfLocalDayUtc(now, tz))
  if (day >= limits.dailyUsd) throw new BudgetExceededError('daily', limits.dailyUsd, day)
  const month = await spentSince(db, startOfLocalMonthUtc(now, tz))
  if (month >= limits.monthlyUsd) throw new BudgetExceededError('monthly', limits.monthlyUsd, month)
}

import { migrations } from './migrations.generated'

/**
 * Porta mínima de acesso ao SQLite. O app implementa com tauri-plugin-sql;
 * testes podem implementar com node:sqlite.
 */
export interface SqlExecutor {
  execute(sql: string, params?: unknown[]): Promise<void>
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

const MIGRATIONS_TABLE = '_pingo_migrations'

/**
 * Aplica as migrations pendentes, em ordem.
 * Sem transação: o pool do tauri-plugin-sql pode usar conexões diferentes entre chamadas.
 * A migration só é marcada como aplicada depois de todas as instruções passarem.
 */
export async function runMigrations(db: SqlExecutor): Promise<string[]> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  )
  const done = new Set(
    (await db.select<{ id: string }>(`SELECT id FROM ${MIGRATIONS_TABLE}`)).map((r) => r.id),
  )

  const applied: string[] = []
  for (const migration of migrations) {
    if (done.has(migration.id)) continue
    for (const statement of migration.statements) {
      await db.execute(statement)
    }
    await db.execute(`INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`, [
      migration.id,
      new Date().toISOString(),
    ])
    applied.push(migration.id)
  }
  return applied
}

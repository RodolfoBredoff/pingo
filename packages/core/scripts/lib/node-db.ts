import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { runMigrations, schema, type PingoDb, type SqlExecutor } from '../../src'

/**
 * Banco SQLite em Node (node:sqlite) com o MESMO driver sqlite-proxy usado pelo app Tauri.
 * Só para scripts e verificações; não entra no bundle do app.
 */
export async function openNodeDb(path = ':memory:'): Promise<PingoDb> {
  const sqlite = new DatabaseSync(path)
  sqlite.exec('PRAGMA foreign_keys = ON')

  const executor: SqlExecutor = {
    execute: async (sql, params = []) => void sqlite.prepare(sql).run(...(params as never[])),
    select: async <T>(sql: string, params: unknown[] = []) =>
      sqlite.prepare(sql).all(...(params as never[])) as T[],
  }
  await runMigrations(executor)

  return drizzle(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql)
      if (method === 'run') {
        stmt.run(...(params as never[]))
        return { rows: [] }
      }
      stmt.setReturnArrays(true)
      const rows = stmt.all(...(params as never[])) as unknown as unknown[][]
      return { rows: (method === 'get' ? rows[0] : rows) as unknown[] }
    },
    { schema },
  )
}

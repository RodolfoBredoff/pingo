import Database from '@tauri-apps/plugin-sql'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { runMigrations, schema, type SqlExecutor } from '@pingo/core'

const DB_URL = 'sqlite:pingo.db'

/**
 * Abre o SQLite local via tauri-plugin-sql, aplica migrations e devolve um cliente Drizzle.
 *
 * Observação do driver sqlite-proxy: o Drizzle lê as linhas por posição, então convertemos
 * os objetos do plugin em arrays (Object.values mantém a ordem das colunas).
 * Consultas com JOIN que repetem o mesmo nome de coluna devem usar aliases.
 */
export async function openDatabase() {
  const conn = await Database.load(DB_URL)

  const executor: SqlExecutor = {
    execute: async (sql, params = []) => {
      await conn.execute(sql, params)
    },
    select: <T>(sql: string, params: unknown[] = []) => conn.select<T[]>(sql, params),
  }

  const applied = await runMigrations(executor)

  const db = drizzle(
    async (sql, params, method) => {
      if (method === 'run') {
        await conn.execute(sql, params)
        return { rows: [] }
      }
      const rows = await conn.select<Record<string, unknown>[]>(sql, params)
      const arrays = rows.map((r) => Object.values(r))
      // `get` espera uma única linha (ou undefined); os demais esperam a lista.
      return { rows: (method === 'get' ? arrays[0] : arrays) as unknown[] }
    },
    { schema },
  )

  return { db, executor, applied }
}

export type PingoDb = Awaited<ReturnType<typeof openDatabase>>['db']

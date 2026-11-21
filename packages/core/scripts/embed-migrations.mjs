// Lê packages/core/drizzle/*.sql e gera src/db/migrations.generated.ts.
// Rodar com: pnpm --filter @pingo/core db:generate
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'drizzle')

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const migrations = files.map((file) => {
  const sql = readFileSync(join(dir, file), 'utf8')
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
  return { id: file.replace(/\.sql$/, ''), statements }
})

const out = `// ARQUIVO GERADO por scripts/embed-migrations.mjs. Não edite à mão.
export interface Migration {
  id: string
  statements: string[]
}

export const migrations: Migration[] = ${JSON.stringify(migrations, null, 2)}
`

writeFileSync(join(root, 'src/db/migrations.generated.ts'), out)
console.log(`${migrations.length} migration(s) embutida(s).`)

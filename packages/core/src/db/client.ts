import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type * as schema from './schema'

/** Cliente Drizzle (driver sqlite-proxy) usado pelo core. O app e os scripts criam a instância. */
export type PingoDb = SqliteRemoteDatabase<typeof schema>

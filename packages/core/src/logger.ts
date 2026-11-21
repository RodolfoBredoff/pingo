/**
 * Logger estruturado que NUNCA registra conteúdo de mensagens nem segredos (R11.2).
 * Campos sensíveis são substituídos por "[redigido]" em qualquer nível de aninhamento.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const SENSITIVE_KEYS = new Set([
  'text',
  'body',
  'transcript',
  'summary',
  'title',
  'evidence',
  'content',
  'prompt',
  'phone',
  'fromphone',
  'tophone',
  'apikey',
  'authorization',
  'token',
  'secret',
  'password',
])

const REDACTED = '[redigido]'

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(v, depth + 1)
  }
  return out
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  child(scope: string): Logger
}

export interface LoggerOptions {
  level?: LogLevel
  scope?: string
  /** Destino das linhas. Padrão: console. */
  sink?: (line: string, level: LogLevel) => void
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.level ?? 'info'
  const scope = options.scope ?? 'pingo'
  const sink =
    options.sink ??
    ((line, level) => {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      fn(line)
    })

  const write = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return
    const entry = {
      t: new Date().toISOString(),
      level,
      scope,
      msg,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    }
    sink(JSON.stringify(entry), level)
  }

  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (s) => createLogger({ ...options, scope: `${scope}.${s}` }),
  }
}

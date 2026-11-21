import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { RelayErrorBody, RelayErrorCode } from '@pingo/shared'
import type { Deps } from './ports'

export type HttpEvent = Pick<
  APIGatewayProxyEventV2,
  'headers' | 'body' | 'isBase64Encoded' | 'queryStringParameters' | 'pathParameters'
>
export type HttpResult = Exclude<APIGatewayProxyResultV2, string>

export const MAX_BODY_BYTES = 64 * 1024

const STATUS: Record<RelayErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  too_large: 413,
  window_closed: 409,
  whatsapp_error: 502,
  not_configured: 503,
  internal: 500,
}

export function json(status: number, body: unknown): HttpResult {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  }
}

export function fail(code: RelayErrorCode, detail?: string): HttpResult {
  const body: RelayErrorBody = detail ? { error: code, detail } : { error: code }
  return json(STATUS[code], body)
}

/** Cabeçalhos do API Gateway HTTP já chegam em minúsculas. */
export function header(e: HttpEvent, name: string): string | undefined {
  return e.headers?.[name.toLowerCase()]
}

/** Corpo bruto em bytes (o HMAC da Meta é sobre os bytes exatos). */
export function rawBody(e: HttpEvent): Buffer {
  if (!e.body) return Buffer.alloc(0)
  return e.isBase64Encoded ? Buffer.from(e.body, 'base64') : Buffer.from(e.body, 'utf8')
}

export class BadRequest extends Error {}

export function parseJson<T>(e: HttpEvent, maxBytes = MAX_BODY_BYTES): T {
  const raw = rawBody(e)
  if (raw.length > maxBytes) throw new TooLarge()
  try {
    const v: unknown = JSON.parse(raw.toString('utf8'))
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
    return v as T
  } catch {
    throw new BadRequest('JSON inválido')
  }
}

export class TooLarge extends Error {}

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Confere o token do dispositivo (Bearer). Devolve null se válido, senão a resposta de erro.
 * O token nunca é guardado: só o hash SHA-256 (design.md §5).
 */
export async function authenticate(deps: Deps, e: HttpEvent): Promise<HttpResult | null> {
  const auth = header(e, 'authorization')
  const m = /^Bearer\s+(\S{20,200})$/.exec(auth ?? '')
  if (!m) return fail('unauthorized')
  const dev = await deps.db.get('DEVICE', 'main')
  const stored = typeof dev?.tokenHash === 'string' ? dev.tokenHash : ''
  if (!stored || !safeEqualHex(sha256Hex(m[1]!), stored)) return fail('unauthorized')
  return null
}

/** Marca o dispositivo como "online agora" (decide o "Recebi!" quando está offline). */
export async function touchDevice(deps: Deps): Promise<void> {
  await deps.db.update('DEVICE', 'main', { lastSeenMs: deps.clock().getTime() })
}

/** Envolve um handler tratando erros comuns de forma uniforme. */
export function guard(
  deps: () => Deps,
  fn: (d: Deps, e: HttpEvent) => Promise<HttpResult>,
): (e: HttpEvent) => Promise<HttpResult> {
  return async (e) => {
    const d = deps()
    try {
      return await fn(d, e)
    } catch (err) {
      if (err instanceof BadRequest) return fail('bad_request', err.message)
      if (err instanceof TooLarge) return fail('too_large')
      d.log.error('falha não tratada', { error: err instanceof Error ? err.name : 'desconhecido' })
      return fail('internal')
    }
  }
}

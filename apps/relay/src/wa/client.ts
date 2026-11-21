import { WaError, type WaMedia, type WaPayload, type WhatsApp, type Secrets } from '../ports'

export interface WaClientOptions {
  secrets: Secrets
  /** Para testes: aponta para um servidor falso no lugar da Meta. */
  baseUrl?: string
  version?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

const DEFAULT_BASE = 'https://graph.facebook.com'
/** v25.0 é estável até 2028 (changelog da Graph API). */
export const DEFAULT_GRAPH_VERSION = 'v25.0'

const META_HOSTS = /(^|\.)(facebook\.com|fbcdn\.net|fbsbx\.com|whatsapp\.net|whatsapp\.com)$/

export function isMetaMediaUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && META_HOSTS.test(u.hostname)
  } catch {
    return false
  }
}

export function createWaClient(opts: WaClientOptions): WhatsApp {
  const base = opts.baseUrl ?? DEFAULT_BASE
  const version = opts.version ?? DEFAULT_GRAPH_VERSION
  const doFetch = opts.fetchFn ?? fetch
  const timeout = opts.timeoutMs ?? 8000

  async function call(url: string, init: RequestInit & { bearer: string }): Promise<Response> {
    const { bearer, ...rest } = init
    return doFetch(url, {
      ...rest,
      headers: { ...(rest.headers ?? {}), authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(timeout),
    })
  }

  async function failFrom(res: Response): Promise<never> {
    let code: number | undefined
    let message = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { error?: { code?: number; message?: string } }
      code = j.error?.code
      // A mensagem de erro da Meta não leva conteúdo nosso; mesmo assim só o código sai nos logs.
      message = j.error?.message ?? message
    } catch {
      /* resposta sem JSON */
    }
    throw new WaError(res.status, code, message)
  }

  return {
    async send(payload: WaPayload) {
      const [token, phoneId] = await Promise.all([
        opts.secrets.get('access-token'),
        opts.secrets.get('phone-number-id'),
      ])
      if (!token || !phoneId) throw new WaError(503, undefined, 'credenciais da Meta ausentes')
      const res = await call(`${base}/${version}/${encodeURIComponent(phoneId)}/messages`, {
        method: 'POST',
        bearer: token,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return failFrom(res)
      const j = (await res.json()) as { messages?: { id?: string }[] }
      return { messageId: j.messages?.[0]?.id ?? '' }
    },

    async getMedia(mediaId: string, maxBytes: number): Promise<WaMedia> {
      const token = await opts.secrets.get('access-token')
      if (!token) throw new WaError(503, undefined, 'credenciais da Meta ausentes')
      const meta = await call(`${base}/${version}/${encodeURIComponent(mediaId)}`, {
        method: 'GET',
        bearer: token,
      })
      if (!meta.ok) return failFrom(meta)
      const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number }
      if (!info.url) throw new WaError(502, undefined, 'resposta sem link de mídia')
      // O token vai junto no download: só enviamos a endereços da Meta, nunca a um host qualquer.
      if (!opts.baseUrl && !isMetaMediaUrl(info.url)) {
        throw new WaError(502, undefined, 'link de mídia fora da Meta')
      }
      if ((info.file_size ?? 0) > maxBytes)
        throw new WaError(413, undefined, 'arquivo grande demais')
      const file = await call(info.url, { method: 'GET', bearer: token })
      if (!file.ok) return failFrom(file)
      const data = new Uint8Array(await file.arrayBuffer())
      if (data.length > maxBytes) throw new WaError(413, undefined, 'arquivo grande demais')
      return {
        data,
        mimeType: info.mime_type ?? file.headers.get('content-type') ?? 'application/octet-stream',
      }
    },
  }
}

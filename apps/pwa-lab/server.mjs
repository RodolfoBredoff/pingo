// Servidor do laboratório PWA (descartável). Serve os arquivos, guarda a inscrição de push, dispara
// pushes agendados e recebe os relatórios que o celular manda, para eu ler no terminal.
// Uso: pnpm --filter @pingo/pwa-lab start   (e um túnel HTTPS: cloudflared tunnel --url http://localhost:8787)
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as webpush from 'web-push'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PUBLIC = join(ROOT, 'public')
const SQLITE = join(ROOT, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist')
const STATE_DIR = join(ROOT, '.lab')
const PORT = Number(process.env.PORT ?? 8787)
mkdirSync(STATE_DIR, { recursive: true })

const readJson = (file, fallback) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
const writeJson = (file, v) => writeFileSync(file, JSON.stringify(v, null, 2))

// Chave de acesso (vai no link como #k=..., que o navegador não envia ao servidor) e chaves VAPID.
const keyFile = join(STATE_DIR, 'key.json')
let { key } = readJson(keyFile, {})
if (!key) {
  key = randomBytes(18).toString('base64url')
  writeJson(keyFile, { key })
}
const vapidFile = join(STATE_DIR, 'vapid.json')
let vapid = readJson(vapidFile, null)
if (!vapid) {
  vapid = webpush.generateVAPIDKeys()
  writeJson(vapidFile, vapid)
}
webpush.setVapidDetails(
  'https://github.com/RodolfoBredoff/pingo',
  vapid.publicKey,
  vapid.privateKey,
)

const subFile = join(STATE_DIR, 'subscription.json')
let subscription = readJson(subFile, null)
const logFile = join(STATE_DIR, 'log.jsonl')

function log(event, data = {}) {
  const line = { t: new Date().toISOString(), event, ...data }
  appendFileSync(logFile, JSON.stringify(line) + '\n')
  const hhmmss = line.t.slice(11, 19)
  console.log(`[${hhmmss}] ${event} ${JSON.stringify(data)}`)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(body)
}
const sendJson = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), { 'content-type': 'application/json' })

async function readBody(req, max = 1_000_000) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > max) throw new Error('corpo grande demais')
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function authorized(req) {
  const given = req.headers['x-lab-key']
  return typeof given === 'string' && given === key
}

function serveFile(res, base, rel) {
  const path = normalize(join(base, rel))
  if (!path.startsWith(base) || !existsSync(path)) return send(res, 404, 'não encontrado')
  const headers = { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' }
  if (rel === 'sw.js') headers['service-worker-allowed'] = '/'
  send(res, 200, readFileSync(path), headers)
}

const scheduled = new Map()

function schedulePush({ id, afterSec, urgency }) {
  const dueAt = Date.now() + afterSec * 1000
  const timer = setTimeout(async () => {
    scheduled.delete(id)
    if (!subscription) return log('push_skipped', { id, reason: 'sem inscrição' })
    const sentAt = Date.now()
    try {
      const r = await webpush.sendNotification(subscription, JSON.stringify({ id, sentAt }), {
        TTL: 3600,
        urgency: urgency ?? 'high',
      })
      log('push_sent', { id, status: r.statusCode, lateByMs: sentAt - dueAt })
    } catch (e) {
      log('push_error', {
        id,
        status: e.statusCode,
        body: String(e.body ?? e.message).slice(0, 200),
      })
      if (e.statusCode === 404 || e.statusCode === 410) {
        subscription = null
        writeJson(subFile, null)
      }
    }
  }, afterSec * 1000)
  scheduled.set(id, { timer, dueAt })
  log('push_scheduled', { id, afterSec, dueAt: new Date(dueAt).toISOString() })
  return dueAt
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  try {
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/vapid') return sendJson(res, 200, { publicKey: vapid.publicKey })
      if (!authorized(req)) return sendJson(res, 401, { error: 'sem chave' })

      if (req.method === 'POST' && url.pathname === '/api/subscribe') {
        const body = JSON.parse(await readBody(req))
        subscription = body.subscription
        writeJson(subFile, subscription)
        log('subscribed', { endpointHost: new URL(subscription.endpoint).host })
        return sendJson(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/push') {
        const body = JSON.parse(await readBody(req))
        const afterSec = Math.min(3600, Math.max(0, Number(body.afterSec) || 0))
        if (typeof body.id !== 'string' || body.id.length > 80)
          return sendJson(res, 400, { error: 'id' })
        const dueAt = schedulePush({ id: body.id, afterSec, urgency: body.urgency })
        return sendJson(res, 200, { dueAt })
      }
      if (req.method === 'POST' && url.pathname === '/api/log') {
        const body = JSON.parse(await readBody(req))
        log(`app:${String(body.event).slice(0, 40)}`, body.data ?? {})
        return sendJson(res, 200, { ok: true })
      }
      return sendJson(res, 404, { error: 'rota' })
    }

    if (req.method === 'POST' && url.pathname === '/share-target') {
      // Só chega aqui se o service worker NÃO interceptou: é um achado importante do teste.
      log('share_hit_server_without_sw', { contentType: req.headers['content-type']?.slice(0, 60) })
      return send(res, 303, '', { location: '/?share=sem-sw' })
    }

    if (req.method !== 'GET') return send(res, 405, 'método')
    if (url.pathname.startsWith('/vendor/sqlite/')) {
      return serveFile(res, SQLITE, url.pathname.slice('/vendor/sqlite/'.length))
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    return serveFile(res, PUBLIC, rel)
  } catch (e) {
    log('server_error', { message: String(e.message).slice(0, 120) })
    return sendJson(res, 400, { error: 'pedido inválido' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Laboratório PWA em http://localhost:${PORT}`)
  console.log(`Chave de acesso (vai no link, depois de #k=): ${key}`)
  console.log(`Inscrição de push: ${subscription ? 'já existe' : 'ainda não'}`)
})

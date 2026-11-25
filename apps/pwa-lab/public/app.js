/* global labIdb */
// Página do laboratório. Cada teste mostra o resultado na tela e o manda ao terminal do computador.
const $ = (id) => document.getElementById(id)
const tag = (text, kind) => `<span class="tag ${kind}">${text}</span>`

// ---------------------------------------------------------------- chave de acesso
const fragment = new URLSearchParams(location.hash.slice(1))
if (fragment.get('k')) {
  localStorage.setItem('labKey', fragment.get('k'))
  await labIdb.put('kv', fragment.get('k'), 'labKey')
  history.replaceState(null, '', location.pathname + location.search)
}
let KEY = localStorage.getItem('labKey') ?? (await labIdb.get('kv', 'labKey'))
if (KEY) await labIdb.put('kv', KEY, 'labKey')

async function api(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lab-key': KEY ?? '' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  return r.json()
}

function addLine(event, data) {
  const line = `${new Date().toLocaleTimeString('pt-BR')} ${event} ${data ? JSON.stringify(data) : ''}\n`
  $('log').textContent = (line + $('log').textContent).slice(0, 6000)
}

async function report(event, data = {}) {
  addLine(event, data)
  if (!KEY) return
  try {
    await api('/api/log', { event, data: { ...data, phoneTime: new Date().toISOString() } })
  } catch {
    /* sem rede */
  }
}

if (!KEY) {
  const box = document.createElement('section')
  box.innerHTML =
    '<h2>Chave de acesso</h2><p>Esta janela ainda não tem a chave. Cole aqui a chave que aparece no terminal do computador.</p><input id="key-in" style="width:100%;padding:10px;font:inherit"><button id="key-save" class="pri">Salvar</button>'
  document.body.prepend(box)
  $('key-save').onclick = async () => {
    KEY = $('key-in').value.trim()
    localStorage.setItem('labKey', KEY)
    await labIdb.put('kv', KEY, 'labKey')
    location.reload()
  }
}

// ---------------------------------------------------------------- 1. instalação
const standalone = matchMedia('(display-mode: standalone)').matches
let deferredPrompt
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
  $('btn-install').hidden = false
})
addEventListener('appinstalled', () => report('app_installed'))
$('btn-install').onclick = async () => {
  deferredPrompt.prompt()
  const r = await deferredPrompt.userChoice
  report('install_choice', { outcome: r.outcome })
}

async function renderInstall() {
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : {}
  $('install-info').innerHTML = `
    <p>Aberto como app instalado: ${standalone ? tag('sim', 'ok') : tag('não (navegador)', 'warn')}</p>
    <p>Armazenamento permanente: ${persisted ? tag('sim', 'ok') : tag('não', 'warn')}
       <small>usado ${Math.round((est.usage ?? 0) / 1024)} KB de ${Math.round((est.quota ?? 0) / 1048576)} MB</small></p>`
  return {
    persisted,
    usageKB: Math.round((est.usage ?? 0) / 1024),
    quotaMB: Math.round((est.quota ?? 0) / 1048576),
  }
}
$('btn-persist').onclick = async () => {
  const granted = navigator.storage?.persist ? await navigator.storage.persist() : false
  report('persist_requested', { granted })
  renderInstall()
}

// ---------------------------------------------------------------- 2. Compartilhar
async function decodeAudio(blob) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    ctx.close()
    return { ok: true, seconds: Number(buf.duration.toFixed(2)), channels: buf.numberOfChannels }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 80) }
  }
}

async function describeFile(f) {
  const head = new Uint8Array(await f.blob.slice(0, 8).arrayBuffer())
  const magic = [...head].map((b) => b.toString(16).padStart(2, '0')).join('')
  const info = { name: f.name, type: f.type, bytes: f.size, magic }
  if (f.type.startsWith('audio/')) info.decode = await decodeAudio(f.blob)
  if (f.type === 'application/pdf')
    info.pdfHeader = new TextDecoder().decode(head.slice(0, 5)) === '%PDF-'
  return info
}

async function renderShares() {
  const all = (await labIdb.all('shares')).slice(-5).reverse()
  const box = $('shares')
  box.innerHTML = all.length ? '' : '<p><small>Nada recebido ainda.</small></p>'
  for (const s of all) {
    const div = document.createElement('div')
    div.style.cssText = 'border-top:1px solid #0002;padding:8px 0'
    const parts = [`<p><b>#${s.id}</b> <small>${s.at}</small></p>`]
    if (s.title) parts.push(`<p><small>título:</small> ${escapeHtml(s.title)}</p>`)
    if (s.text)
      parts.push(
        `<p><small>texto (${s.text.length} caracteres):</small> ${escapeHtml(s.text.slice(0, 300))}</p>`,
      )
    if (s.url) parts.push(`<p><small>link:</small> ${escapeHtml(s.url)}</p>`)
    div.innerHTML = parts.join('')
    for (const f of s.files) {
      const url = URL.createObjectURL(f.blob)
      const el = document.createElement('div')
      el.innerHTML = `<p>${tag(f.type || 'sem tipo', 'na')} ${f.name} — ${(f.size / 1024).toFixed(1)} KB</p>`
      if (f.type.startsWith('image/')) el.innerHTML += `<img class="prev" src="${url}">`
      if (f.type.startsWith('audio/')) el.innerHTML += `<audio controls src="${url}"></audio>`
      div.append(el)
    }
    box.append(div)
  }
}

const escapeHtml = (t) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

async function onSharedOpened() {
  const params = new URLSearchParams(location.search)
  const id = Number(params.get('shared'))
  if (params.get('share')) await report('share_failed_page', { reason: params.get('share') })
  if (!id) return
  const rec = (await labIdb.all('shares')).find((s) => s.id === id)
  if (!rec) return
  const files = []
  for (const f of rec.files) files.push(await describeFile(f))
  await report('share_opened_in_page', {
    id,
    standalone,
    textLength: rec.text.length,
    hasUrl: !!rec.url,
    files,
  })
  history.replaceState(null, '', location.pathname)
}

// ---------------------------------------------------------------- 3. push
const b64ToBytes = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
let reg

async function renderPush() {
  const perm = 'Notification' in window ? Notification.permission : 'indisponível'
  $('push-info').innerHTML =
    `<p>Service worker: ${reg ? tag('ativo', 'ok') : tag('indisponível', 'bad')}
    · Permissão: ${perm === 'granted' ? tag('concedida', 'ok') : tag(perm, 'warn')}</p>`
  const ready = perm === 'granted' && !!reg
  for (const id of ['btn-30', 'btn-120', 'btn-600']) $(id).disabled = !ready
}

async function subscribe() {
  const { publicKey } = await (await fetch('/api/vapid')).json()
  let sub = await reg.pushManager.getSubscription()
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64ToBytes(publicKey),
  })
  await api('/api/subscribe', { subscription: sub.toJSON() })
  return sub
}

$('btn-notify').onclick = async () => {
  try {
    const perm = await Notification.requestPermission()
    await report('notification_permission', { perm })
    if (perm === 'granted') {
      await subscribe()
      await report('push_subscribed', {})
    }
  } catch (e) {
    await report('push_subscribe_error', { name: e.name, message: String(e.message).slice(0, 120) })
  }
  renderPush()
}

async function schedule(sec) {
  const id = 'rem-' + Date.now().toString(36)
  await labIdb.put('reminders', {
    id,
    title: 'Dentista amanhã às 15:00',
    body: `Teste do Pingo Lab (agendado para ${sec} s)`,
  })
  const r = await api('/api/push', { id, afterSec: sec })
  await report('push_requested', { id, afterSec: sec, dueAt: new Date(r.dueAt).toISOString() })
}
$('btn-30').onclick = () => schedule(30)
$('btn-120').onclick = () => schedule(120)
$('btn-600').onclick = () => schedule(600)

// ---------------------------------------------------------------- 4. SQLite
const dbWorker = new Worker('/db-worker.js', { type: 'module' })
function dbCall(msg) {
  return new Promise((resolve) => {
    const on = (e) => {
      if (e.data.op !== msg.op) return
      dbWorker.removeEventListener('message', on)
      resolve(e.data)
    }
    dbWorker.addEventListener('message', on)
    dbWorker.postMessage(msg)
  })
}
function showDb(r, label) {
  $('db-info').innerHTML = r.ok
    ? `<p>${tag('funcionando', 'ok')} ${r.info ? `SQLite ${r.info.sqlite} (${r.info.vfs})` : ''}</p>
       <p>Linhas gravadas: <b>${r.rows}</b> <small>${label ?? ''} ${r.ms.toFixed(0)} ms</small></p>`
    : `<p>${tag('erro', 'bad')} ${r.error}</p>`
}
$('btn-db-insert').onclick = async () => {
  const r = await dbCall({ op: 'insert', n: 1000 })
  showDb(r, 'gravou 1000 linhas em')
  report('db_insert', { ok: r.ok, rows: r.rows, ms: Math.round(r.ms ?? 0), error: r.error })
}
$('btn-db-clear').onclick = async () => showDb(await dbCall({ op: 'clear' }), 'limpou em')
$('btn-db-reload').onclick = () => location.reload()

// ---------------------------------------------------------------- 5. microfone
const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
const mime =
  typeof MediaRecorder !== 'undefined'
    ? MIMES.find((m) => MediaRecorder.isTypeSupported(m))
    : undefined
$('mic-info').innerHTML =
  `<p>Formato de gravação: ${mime ? tag(mime, 'ok') : tag('sem suporte', 'bad')}</p>`
$('btn-mic').onclick = async () => {
  const out = $('mic-out')
  out.innerHTML = '<p>Pedindo o microfone…</p>'
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    out.innerHTML = `<p>${tag('negado', 'bad')} ${e.name}</p>`
    return report('mic_error', { name: e.name, message: String(e.message).slice(0, 100) })
  }
  const chunks = []
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop())
    const blob = new Blob(chunks, { type: rec.mimeType })
    const decode = await decodeAudio(blob)
    out.innerHTML = `<p>${tag('gravou', 'ok')} ${rec.mimeType} — ${(blob.size / 1024).toFixed(1)} KB · decodificação: ${decode.ok ? tag(decode.seconds + ' s', 'ok') : tag(decode.error, 'bad')}</p><audio controls src="${URL.createObjectURL(blob)}"></audio>`
    report('mic_recorded', { mime: rec.mimeType, bytes: blob.size, decode })
  }
  rec.start()
  out.innerHTML = '<p>Gravando… fale por 5 segundos.</p>'
  setTimeout(() => rec.stop(), 5000)
}

// ---------------------------------------------------------------- partida
// Nada aqui pode travar a tela: cada parte falha ou demora sozinha.
const withTimeout = (p, ms, what) =>
  Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${what} demorou mais de ${ms / 1000} s`)), ms),
    ),
  ])

const dbStart = dbCall({ op: 'init' }).then((r) => {
  showDb(r, 'ao abrir: ')
  return r
})

try {
  reg =
    'serviceWorker' in navigator
      ? await withTimeout(navigator.serviceWorker.register('/sw.js'), 10000, 'registro do SW')
      : undefined
  if (reg) await withTimeout(navigator.serviceWorker.ready, 10000, 'SW pronto')
} catch (e) {
  await report('sw_register_error', { message: String(e.message).slice(0, 120) })
}
const stor = await renderInstall()
await renderPush()
await renderShares()
if (reg && 'Notification' in window && Notification.permission === 'granted') {
  // Renova a inscrição em segundo plano; na primeira vez o FCM pode levar alguns segundos.
  subscribe().then(
    () => report('push_resubscribed'),
    (e) =>
      report('push_subscribe_error', { name: e.name, message: String(e.message).slice(0, 120) }),
  )
}
const dbFirst = await withTimeout(dbStart, 20000, 'banco').catch((e) => ({
  ok: false,
  error: e.message,
}))
await report('app_opened', {
  standalone,
  url: location.pathname + location.search,
  ua: navigator.userAgent.slice(0, 160),
  swControlling: !!navigator.serviceWorker?.controller,
  notification: 'Notification' in window ? Notification.permission : 'n/a',
  storage: stor,
  db: { ok: dbFirst.ok, rows: dbFirst.rows, error: dbFirst.error, info: dbFirst.info },
  recordingMime: mime ?? null,
})
await onSharedOpened()

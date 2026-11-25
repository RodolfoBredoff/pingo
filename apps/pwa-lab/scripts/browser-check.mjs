// Testa o laboratório num Chrome de verdade (sem tela) no computador, antes de ir para o celular.
// Uso: node scripts/browser-check.mjs   (com o servidor rodando em :8787)
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const key = JSON.parse(readFileSync(new URL('../.lab/key.json', import.meta.url), 'utf8')).key
const BASE = 'http://localhost:8787'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let fails = 0
const check = (ok, what, extra) => {
  console.log(
    `  ${ok ? '✅' : '❌'} ${what}${!ok && extra !== undefined ? `\n      ↳ ${JSON.stringify(extra)}` : ''}`,
  )
  if (!ok) fails++
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-first-run', '--disable-gpu', '--user-data-dir=/tmp/pwa-lab-chrome-' + Date.now()],
})
const ctx = browser.defaultBrowserContext()
await ctx.overridePermissions(BASE, ['notifications', 'microphone'])
const page = await browser.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 160)))
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 160)))

console.log('--- página, banco e service worker')
await page.goto(`${BASE}/#k=${key}`, { waitUntil: 'load' })
await page
  .waitForFunction(() => document.getElementById('db-info')?.textContent?.includes('SQLite'), {
    timeout: 20000,
  })
  .catch(() => {})
const text = (id) =>
  page.$eval(`#${id}`, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '(vazio)')
const db = await text('db-info')
check(/funcionando/.test(db) && /opfs-sahpool/.test(db), 'SQLite WASM + OPFS iniciou', db)
const push = await text('push-info')
check(/Service worker: ativo/.test(push), 'service worker registrado', push)

console.log('\n--- banco persiste ao recarregar')
await page.click('#btn-db-clear')
await wait(500)
await page.click('#btn-db-insert')
await page
  .waitForFunction(
    () => /Linhas gravadas: 1000/.test(document.getElementById('db-info').textContent),
    { timeout: 20000 },
  )
  .catch(() => {})
check(
  /Linhas gravadas: 1000/.test(await text('db-info')),
  'gravou 1000 linhas',
  await text('db-info'),
)
await page.reload({ waitUntil: 'load' })
await page
  .waitForFunction(() => /Linhas gravadas/.test(document.getElementById('db-info').textContent), {
    timeout: 20000,
  })
  .catch(() => {})
check(
  /Linhas gravadas: 1000/.test(await text('db-info')),
  'depois de recarregar continuam 1000 linhas',
  await text('db-info'),
)

console.log('\n--- Compartilhar (simulado: POST multipart como o Android faz)')
await page
  .waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 10000 })
  .catch(() => {})
const shareResult = await page.evaluate(async () => {
  const fd = new FormData()
  fd.set('title', '')
  fd.set('text', 'Reunião de pais sexta às 19h no auditório')
  fd.append(
    'media',
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])], 'aviso.pdf', {
      type: 'application/pdf',
    }),
  )
  const r = await fetch('/share-target', { method: 'POST', body: fd, redirect: 'manual' })
  return { type: r.type, status: r.status }
})
check(
  shareResult.type === 'opaqueredirect' || shareResult.status === 303,
  'o service worker interceptou o POST e redirecionou',
  shareResult,
)
await page.goto(`${BASE}/?shared=1`, { waitUntil: 'load' })
await page
  .waitForFunction(() => document.getElementById('shares')?.textContent?.includes('Reunião'), {
    timeout: 15000,
  })
  .catch(() => {})
const shares = await text('shares')
check(
  /Reunião de pais/.test(shares) && /application\/pdf/.test(shares),
  'o compartilhamento ficou guardado e aparece na página',
  shares.slice(0, 200),
)

console.log('\n--- push (o Chrome do computador também recebe Web Push)')
await page.click('#btn-notify')
await wait(4000)
const pushAfter = await text('push-info')
check(/Permissão: concedida/.test(pushAfter), 'permissão de notificações concedida', pushAfter)
const subscribed = await page.evaluate(
  async () => !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription()),
)
check(subscribed, 'inscrição de push criada (FCM respondeu)')
if (subscribed) {
  await page.click('#btn-30')
  console.log('   (o Chrome sem tela não recebe push do FCM; a entrega real só vale no celular)')
  await wait(2000)
}

console.log('\n--- erros no console da página')
check(
  consoleErrors.length === 0,
  `sem erros de JavaScript (${consoleErrors.length})`,
  consoleErrors.slice(0, 5),
)

await browser.close()
console.log(fails === 0 ? '\n✅ Navegador ok.' : `\n❌ ${fails} verificação(ões) falharam.`)
process.exit(fails === 0 ? 0 : 1)

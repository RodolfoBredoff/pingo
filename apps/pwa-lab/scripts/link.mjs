// Monta o link (com a chave) e o QR para abrir o laboratório no celular.
// Uso: node scripts/link.mjs https://alguma-coisa.trycloudflare.com
import { readFileSync, writeFileSync } from 'node:fs'
import QRCode from 'qrcode'

const base = (process.argv[2] ?? '').replace(/\/+$/, '')
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base)) {
  console.error('Uso: node scripts/link.mjs https://alguma-coisa.trycloudflare.com')
  process.exit(1)
}
const dir = new URL('../.lab/', import.meta.url)
const { key } = JSON.parse(readFileSync(new URL('key.json', dir), 'utf8'))
const link = `${base}/#k=${key}`
writeFileSync(new URL('link.txt', dir), link + '\n')
writeFileSync(
  new URL('qr.svg', dir),
  await QRCode.toString(link, { type: 'svg', margin: 2, width: 360, errorCorrectionLevel: 'M' }),
)
console.log(`Link: ${link}\nQR salvo em apps/pwa-lab/.lab/qr.svg`)

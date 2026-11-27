import { invoke } from '@tauri-apps/api/core'

/**
 * Recebe o que o menu "Compartilhar" do Android entregou ao Pingo (texto, imagem, PDF, áudio)
 * e passa para o mesmo caminho do chat. O lado nativo (plugin `pingo`) guarda os itens numa fila;
 * aqui é que a gente busca. Buscar (em vez de esperar um evento) não perde nada quando o app
 * ainda estava abrindo no momento do compartilhamento.
 */

interface SharedItem {
  id: string
  kind: 'text' | 'image' | 'pdf' | 'audio' | 'other'
  mime: string
  name?: string
  size?: number
  path?: string
  text?: string
  error?: 'too_large' | 'unreadable'
}

export interface ShareDeps {
  /** Só busca quando o app consegue processar (pronto e com chave). Senão os itens esperam na fila. */
  ready(): boolean
  onText(text: string): Promise<void>
  onFile(file: File, caption?: string): Promise<void>
  notify(text: string, tone?: 'ok' | 'warn' | 'error'): void
}

const log = (line: string) =>
  void invoke('dev_log', { line: `[share] ${line}` }).catch(() => undefined)

let started = false
let busy = false
let lastWaitLog = 0

async function handle(it: SharedItem, d: ShareDeps) {
  if (it.error) {
    log(`erro ${it.error} (${it.mime})`)
    d.notify(
      it.error === 'too_large' ? 'Esse arquivo passa de 10 MB.' : 'Não consegui ler esse arquivo.',
      'warn',
    )
    return
  }
  if (it.kind === 'text' && !it.path) {
    log(`texto ${it.text?.length ?? 0} caracteres`)
    await d.onText(it.text ?? '')
    return
  }
  if (!it.path) return
  try {
    if (it.kind === 'other') {
      log(`tipo não suportado ${it.mime}`)
      d.notify('Esse tipo de arquivo eu ainda não leio. Mande texto, imagem, PDF ou áudio.', 'warn')
      return
    }
    const bytes = await invoke<ArrayBuffer>('shared_read', { path: it.path })
    const head = [...new Uint8Array(bytes.slice(0, 8))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    log(`${it.kind} ${it.mime} ${bytes.byteLength} bytes (esperado ${it.size}) cabeçalho ${head}`)
    const fallbackName = `compartilhado.${it.mime.split('/')[1]?.split(';')[0] ?? 'bin'}`
    await d.onFile(new File([bytes], it.name || fallbackName, { type: it.mime }), it.text)
  } finally {
    await invoke('shared_discard', { path: it.path }).catch(() => undefined)
  }
}

async function drain(d: ShareDeps) {
  if (busy) return
  if (!d.ready()) {
    // Sem chave do OpenRouter (ou app ainda abrindo): o que foi compartilhado espera na fila nativa.
    if (Date.now() - lastWaitLog > 15_000) {
      lastWaitLog = Date.now()
      log('aguardando: app não está pronto ou falta a chave do OpenRouter')
    }
    return
  }
  busy = true
  try {
    const r = await invoke<{ items: SharedItem[] }>('shared_take')
    for (const it of r.items) await handle(it, d)
  } catch (e) {
    log(`falha: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    busy = false
  }
}

export function startShareIntake(d: ShareDeps) {
  if (started) return
  started = true
  const tick = () => void drain(d)
  tick()
  document.addEventListener(
    'visibilitychange',
    () => document.visibilityState === 'visible' && tick(),
  )
  window.addEventListener('focus', tick)
  // Rede de segurança para o compartilhamento que chega com o app já na tela.
  setInterval(() => document.visibilityState === 'visible' && tick(), 2000)
}

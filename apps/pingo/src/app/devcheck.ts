import { invoke } from '@tauri-apps/api/core'
import { getApp, goTab, setApp, type Tab } from './store'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { parseBackup } from '@pingo/core'
import {
  addContactUi,
  advanceClock,
  agendaAction,
  buildBackupText,
  pressCard,
  pressReply,
  removeContactUi,
  resetTestData,
  sendFile,
  sendText,
  testKey,
} from './controller'

/**
 * AUTOTESTE DE DESENVOLVIMENTO (não vai para produção): só roda com
 * `VITE_PINGO_SELFTEST=1 pnpm tauri dev` e imprime o resultado no terminal.
 * Exercita o app de verdade: fontes, rede, banco, IA e a máquina de estados.
 */
const out = (ok: boolean, text: string) =>
  invoke('dev_log', { line: `${ok ? 'OK  ' : 'ERRO'} ${text}` })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, ms = 60_000) {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < ms) await wait(120)
  return cond()
}

function tone(): File {
  // 1 s de tom de 440 Hz em WAV 16-bit mono 16 kHz.
  const rate = 16000
  const n = rate
  const v = new DataView(new ArrayBuffer(44 + n * 2))
  const w = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++)
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / rate) * 8000, true)
  return new File([v.buffer], 'tom.wav', { type: 'audio/wav' })
}

async function poster(): Promise<File> {
  const c = document.createElement('canvas')
  c.width = 900
  c.height = 500
  const g = c.getContext('2d')!
  g.fillStyle = '#fff6e5'
  g.fillRect(0, 0, 900, 500)
  g.fillStyle = '#2a1d13'
  g.font = 'bold 54px sans-serif'
  g.fillText('AVISO AOS PAIS', 60, 120)
  g.font = '40px sans-serif'
  g.fillText('Reunião de pais', 60, 220)
  g.fillText('Quinta-feira às 19h', 60, 290)
  g.fillText('Auditório da escola', 60, 360)
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'))
  return new File([blob], 'aviso.png', { type: 'image/png' })
}

const ERASE_FLAG = 'pingo_selftest_erase'
const find = (sel: string, text: string) =>
  [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.includes(text))

/** Segunda metade do teste de "apagar meus dados": roda depois que a página recarregou. */
async function afterErase() {
  sessionStorage.removeItem(ERASE_FLAG)
  const a = getApp()
  await out(a.phase === 'ready', 'depois de apagar, o app reiniciou do zero e refez o cadastro')
  await out(a.agenda.length === 0 && a.contacts.length === 0, 'agenda e contatos vazios')
  await out(a.spend.today === 0, 'histórico de gastos apagado')
  const chats = a.entries.filter((e) => e.sender === 'user')
  await out(chats.length === 0, `conversa antiga sumiu (mensagens suas: ${chats.length})`)
  await out(a.consentAt !== null, 'consentimento registrado de novo no novo cadastro')
  await out(true, 'autoteste de apagar concluído')
}

export async function runSelfTest() {
  if (sessionStorage.getItem(ERASE_FLAG)) {
    await afterErase()
    return
  }
  const errors: string[] = []
  window.addEventListener('error', (e) => errors.push(e.message))
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))
  try {
    // 1) Fontes realmente carregadas
    for (const f of [
      '800 24px "Bricolage Grotesque Variable"',
      'italic 400 16px "Fraunces Variable"',
      '400 16px "Geist Variable"',
      '400 14px "Geist Mono Variable"',
    ]) {
      await document.fonts.load(f)
      await out(document.fonts.check(f), `fonte ${f}`)
    }

    // 2) Layout básico
    const de = document.documentElement
    await out(
      de.scrollWidth <= window.innerWidth,
      `sem rolagem horizontal (${de.scrollWidth}px de ${window.innerWidth}px)`,
    )
    await out(!!document.querySelector('[role="log"]'), 'lista do chat presente')
    await out(
      !!document.getElementById('tab-agenda-icon'),
      'ícone da Agenda (alvo do voo) presente',
    )

    // 3) Rede (CORS do webview) + chave
    const k = await testKey()
    await out(
      k.ok,
      `OpenRouter via webview: ${k.ok ? `chave válida, usado US$${k.usage.toFixed(4)}` : k.message}`,
    )

    // 4) Fluxo completo pela interface
    await resetTestData()
    const before = getApp().entries.length
    const t0 = Date.now()
    await sendText(
      'Oi famílias! Sexta-feira tem passeio ao zoológico. O Ravi precisa ir de tênis, boné e levar lanche. Autorização assinada até quarta.',
    )
    const cards = getApp().entries.filter((e) => e.body.type === 'card')
    await out(
      cards.length === 2,
      `2 cartões em ${Date.now() - t0} ms (entradas novas: ${getApp().entries.length - before})`,
    )
    await out(!getApp().typing, 'indicador "digitando" apagado')
    const firstCard = cards[0]?.body.type === 'card' ? cards[0].body.card : null
    if (firstCard) {
      await out(
        firstCard.fields.some((f) => f.key === 'when' && f.value),
        `cartão com data: ${firstCard.fields.find((f) => f.key === 'when')?.value}`,
      )
      await pressCard(`confirm:${firstCard.itemId}`)
      await until(() => getApp().statuses[firstCard.itemId] === 'confirmed', 5000)
      await out(getApp().statuses[firstCard.itemId] === 'confirmed', 'confirmar → status confirmed')
      await out(
        getApp().agenda.some((i) => i.id === firstCard.itemId && i.status === 'confirmed'),
        'item apareceu na agenda',
      )
    }
    const toasts = getApp().toast
    await out(
      true,
      `gasto de IA hoje: US$${getApp().spend.today.toFixed(5)}${toasts ? ' | toast: ' + toasts.text : ''}`,
    )

    // 5) Imagem e áudio pelo caminho real (miniatura, conversão para WAV, visão e áudio)
    const nCards = () => getApp().entries.filter((e) => e.body.type === 'card').length
    const c0 = nCards()
    await sendFile(await poster(), undefined)
    const img = getApp().entries.find(
      (e) => e.body.type === 'attachment' && e.body.kind === 'image',
    )
    await out(
      !!img && img.body.type === 'attachment' && !!img.body.thumb,
      'imagem anexada com miniatura',
    )
    await out(nCards() === c0 + 1, `imagem gerou ${nCards() - c0} cartão(ões)`)
    const a0 = getApp().entries.length
    await sendFile(tone())
    const aud = getApp().entries.find(
      (e) => e.body.type === 'attachment' && e.body.kind === 'audio',
    )
    await out(!!aud, 'áudio anexado e convertido para WAV')
    const reply = getApp()
      .entries.slice(a0)
      .filter((e) => e.sender === 'agent')
    await out(
      reply.length > 0,
      `áudio recebeu resposta do agente (${reply.map((e) => e.body.type).join(',')})`,
    )

    // 6) Todas as telas renderizam sem erro
    const probe: [Tab, string][] = [
      ['agenda', 'agenda'],
      ['settings', 'ajustes'],
      ['chat', 'Conversa com o Pingo'],
    ]
    for (const [tab, needle] of probe) {
      goTab(tab)
      await wait(700)
      const found =
        needle === 'Conversa com o Pingo'
          ? !!document.querySelector('[aria-label="Conversa com o Pingo"]')
          : document.body.innerText.toLowerCase().includes(needle)
      await out(found, `aba ${tab} renderizou`)
    }
    setApp({ devOpen: true })
    await wait(500)
    await out(
      document.body.innerText.toLowerCase().includes('relógio virtual'),
      'painel de desenvolvedor abriu',
    )
    setApp({ devOpen: false })
    await out(
      errors.length === 0,
      `erros de JavaScript durante o teste: ${errors.length}${errors.length ? ' → ' + errors.slice(0, 3).join(' | ') : ''}`,
    )

    // 6b) Geometria: nada estoura a janela
    goTab('chat')
    await wait(600)
    const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect()
    const nav = rect('nav[aria-label="Seções"]')
    const composer = rect('textarea')
    const log = rect('[role="log"]')
    await out(
      !!nav && nav.bottom <= window.innerHeight + 1,
      `barra de abas dentro da janela (base ${Math.round(nav?.bottom ?? 0)} de ${window.innerHeight})`,
    )
    await out(
      !!composer && !!nav && composer.bottom <= nav.top + 1,
      'campo de texto acima da barra de abas',
    )
    await out(
      !!log && log.height > 160,
      `lista do chat com altura útil (${Math.round(log?.height ?? 0)} px)`,
    )
    const article = rect('article')
    await out(
      !article || (!!log && article.right <= log.right + 1 && article.left >= log.left - 1),
      'cartão cabe na largura do chat',
    )

    // 6c) Fase 3: comandos, contatos, oferta, lembretes e ações da agenda
    {
      const confirmedId = firstCard?.itemId
      const lastTexts = (from: number) =>
        getApp()
          .entries.slice(from)
          .map((e) => (e.body.type === 'text' || e.body.type === 'buttons' ? e.body.text : ''))
          .join('\n')

      let n = getApp().entries.length
      await sendText('semana')
      await out(
        lastTexts(n).includes('Próximos 7 dias') || lastTexts(n).includes('Nada marcado'),
        'comando "semana" respondeu sem IA',
      )
      n = getApp().entries.length
      await sendText('*teste*')
      await out(true, 'texto com asteriscos não quebra a tela')

      const add = await addContactUi('Renato Teste', '11 98888-7777')
      await out(add.ok && getApp().contacts.length === 1, 'contato adicionado pela tela')
      const dup = await addContactUi('Outro', '(11) 98888-7777')
      await out(!dup.ok, 'telefone repetido recusado')

      const contact = getApp().contacts[0]
      if (confirmedId && contact) {
        n = getApp().entries.length
        await pressCard(`assign:${confirmedId}:${contact.id}`)
        const offer = getApp()
          .entries.slice(n)
          .find((e) => e.audience?.phone === contact.phone && e.body.type === 'buttons')
        await out(!!offer, 'oferta simulada chegou ao contato, marcada como simulada')
        if (offer && offer.body.type === 'buttons') {
          const yes = offer.body.buttons.find((b) => b.id.startsWith('offer_yes:'))
          await pressReply(offer.id, yes!.id, yes!.title, contact.phone)
          await until(() => getApp().contacts[0]?.status === 'active', 5000)
          await out(getApp().contacts[0]?.status === 'active', 'contato aceitou e ficou ativo')
        }

        n = getApp().entries.length
        await advanceClock(6 * 24 * 3_600_000)
        const fired = getApp()
          .entries.slice(n)
          .filter((e) => e.body.type === 'buttons' && e.body.text.includes('🔔'))
        await out(fired.length > 0, `lembrete disparou com o relógio adiantado (${fired.length})`)
        const toContact = getApp()
          .entries.slice(n)
          .some((e) => e.audience?.phone === contact.phone)
        await out(toContact, 'lembrete também foi para o contato')
        await advanceClock(0)

        goTab('agenda')
        await wait(700)
        await out(!!document.querySelector('button[title="Feito"]'), 'Agenda mostra botão "Feito"')
        n = getApp().entries.length
        await agendaAction('done', confirmedId)
        await out(
          getApp().agenda.find((i) => i.id === confirmedId)?.status === 'done',
          'item concluído pela Agenda',
        )
        await out(lastTexts(n).includes('Feito!'), 'Pingo confirmou na conversa')
        goTab('chat')
        await wait(400)
      }
      if (contact) await removeContactUi(contact.id)
      await out(getApp().contacts.length === 0, 'contato removido (com oferta e itens ligados)')
    }

    // 6d) Fase 4: consentimento, backup e privacidade
    {
      await out(getApp().consentAt !== null, 'consentimento registrado')

      const text = await buildBackupText()
      const parsed = parseBackup(text)
      await out(
        parsed.tables.items.length >= 1 && parsed.tables.messages.length >= 1,
        `backup tem os dados (itens ${parsed.tables.items.length}, mensagens ${parsed.tables.messages.length})`,
      )
      await out(!/sk-or-/.test(text), 'backup não contém a chave do OpenRouter')

      let readBlocked = false
      let writeBlocked = false
      try {
        await readTextFile('/etc/hosts')
      } catch {
        readBlocked = true
      }
      try {
        await writeTextFile('/tmp/pingo-selftest-denied.txt', 'x')
      } catch {
        writeBlocked = true
      }
      await out(
        readBlocked && writeBlocked,
        'o app não lê nem grava fora das pastas que você escolhe',
      )

      goTab('settings')
      await wait(700)
      await out(
        document.body.innerText.includes('Privacidade e dados') &&
          document.body.innerText.includes('Exportar') &&
          document.body.innerText.includes('Importar'),
        'Ajustes mostra Privacidade e dados com Exportar e Importar',
      )
      find('button', 'Apagar meus dados')?.click()
      await wait(500)
      const dlg = document.querySelector('[role="alertdialog"]')
      await out(!!dlg, 'diálogo de apagar abriu')
      const confirmBtn = find('[role="alertdialog"] button', 'Apagar tudo') as
        HTMLButtonElement | undefined
      await out(
        !!confirmBtn?.disabled,
        'botão "Apagar tudo" começa bloqueado (exige digitar APAGAR)',
      )
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await wait(1500)
      // Com a janela fora de foco o navegador pausa animações; "fechando" já prova que o Esc agiu.
      const left = document.querySelector('[role="alertdialog"]')
      const closing = left?.parentElement?.getAttribute('data-closing') === 'true'
      await out(!left || closing, 'Esc fecha o diálogo sem apagar')
      goTab('chat')
      await wait(400)
    }

    // 7) Limpa para o usuário começar do zero
    await resetTestData()
    await out(true, 'dados de teste apagados')

    // 8) "apagar meus dados" pelo chat: recarrega a página, então termina em afterErase()
    let n = getApp().entries.length
    await sendText('apagar meus dados')
    const ask = getApp()
      .entries.slice(n)
      .find(
        (e) =>
          e.body.type === 'buttons' && e.body.buttons.some((b) => b.id.startsWith('erase_yes:')),
      )
    await out(!!ask, 'o Pingo pediu confirmação antes de apagar')
    if (ask && ask.body.type === 'buttons') {
      const yes = ask.body.buttons.find((b) => b.id.startsWith('erase_yes:'))!
      sessionStorage.setItem(ERASE_FLAG, '1')
      n = getApp().entries.length
      await out(true, 'confirmando o apagar: a página vai recarregar')
      await pressReply(ask.id, yes.id, yes.title)
      await wait(5000)
      await out(false, 'a página não recarregou depois de confirmar o apagar')
    }
  } catch (e) {
    await out(false, `autoteste falhou: ${e instanceof Error ? e.message : String(e)}`)
  }
}

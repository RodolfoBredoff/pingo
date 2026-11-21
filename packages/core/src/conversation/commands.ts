/**
 * Comandos de texto exatos. Não gastam IA: regras simples, previsíveis e instantâneas.
 * Qualquer outra coisa segue para o roteador de perguntas ou para a extração.
 */

export type Command =
  | { type: 'range'; range: 'today' | 'tomorrow' | 'week' }
  | { type: 'pending' }
  | { type: 'help' }
  | { type: 'contacts' }
  | { type: 'erase' }
  | { type: 'add_contact'; name: string; phone: string }
  | { type: 'remove_contact'; name: string }
  | { type: 'done'; ref: string }
  | { type: 'cancel'; ref: string }

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[?!.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const ADD =
  /^(?:adiciona|adicionar|add|cadastra|cadastrar|novo contato)\s+(.+?)\s+(\+?[\d][\d\s()\-.]{7,})$/i
const REMOVE =
  /^(?:remove|remover|apaga|apagar|exclui|excluir|tira)\s+(?:o\s+|a\s+)?(?:contato\s+)?(.+)$/i

export function parseCommand(raw: string): Command | null {
  const text = raw.trim()
  if (!text || text.length > 120) return null
  const n = strip(text)

  if (/^(hoje|agenda de hoje|o que tem hoje|compromissos de hoje)$/.test(n))
    return { type: 'range', range: 'today' }
  if (/^(amanha|agenda de amanha|o que tem amanha)$/.test(n))
    return { type: 'range', range: 'tomorrow' }
  if (/^(semana|essa semana|esta semana|agenda|proximos|proximos dias|agenda da semana)$/.test(n))
    return { type: 'range', range: 'week' }
  if (/^(pendentes|pendente|propostas|aguardando)$/.test(n)) return { type: 'pending' }
  if (/^(ajuda|help|comandos|menu|oi|ola|bom dia|boa tarde|boa noite)$/.test(n))
    return { type: 'help' }
  if (/^contatos?$/.test(n)) return { type: 'contacts' }
  if (/^(apagar|apaga|excluir|exclui|deletar) (todos )?(os |as )?(meus |minhas )?dados$/.test(n))
    return { type: 'erase' }

  const add = ADD.exec(text)
  if (add) return { type: 'add_contact', name: add[1]!.trim(), phone: add[2]!.trim() }

  const rem = REMOVE.exec(text)
  if (
    rem &&
    !/^(item|tarefa)\b/i.test(rem[1]!) &&
    /contato/i.test(text.split(/\s+/).slice(0, 3).join(' '))
  ) {
    return { type: 'remove_contact', name: rem[1]!.trim() }
  }

  const done = /^(?:feito|feita|concluido|concluida|conclui|pronto|ja fiz)\s+(.+)$/.exec(n)
  if (done) return { type: 'done', ref: done[1]! }
  const cancel = /^(?:cancela|cancelar|cancele)\s+(?:o\s+|a\s+)?(?:item\s+)?(.+)$/.exec(n)
  if (cancel) return { type: 'cancel', ref: cancel[1]! }

  return null
}

/**
 * Heurística barata: só vale a pena gastar uma chamada de IA para decidir se é pergunta
 * quando o texto é curto e tem cara de pergunta. Recados longos vão direto para a extração.
 */
export function looksLikeQuery(raw: string): boolean {
  const text = raw.trim()
  if (text.length === 0 || text.length > 140) return false
  const n = strip(text)
  if (/\?\s*$/.test(text)) return true
  return /^(o que|oque|que |quais|qual|quando|tem |tenho|ha |onde|quanto|quantos|falta|faltam|me mostra|mostra|lista|listar|compromissos|agenda)/.test(
    n,
  )
}

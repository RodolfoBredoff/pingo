/** Casa o nome citado numa mensagem com um contato cadastrado (R6.1). */

export interface MatchableContact {
  id: string
  name: string
}

export const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const SELF_WORDS = new Set(['eu', 'voce', 'vc', 'me', 'mim'])

/**
 * Devolve o contato quando a correspondência é única; null se não houver ou se for ambígua.
 * Ordem: nome completo igual, primeiro nome igual, início do nome.
 */
export function matchContact<T extends MatchableContact>(
  hint: string | null | undefined,
  contacts: T[],
): T | null {
  const h = normalizeName(hint ?? '')
  if (!h || SELF_WORDS.has(h)) return null

  const pick = (pred: (name: string) => boolean): T | null => {
    const hits = contacts.filter((c) => pred(normalizeName(c.name)))
    return hits.length === 1 ? hits[0]! : null
  }
  const exact = contacts.filter((c) => normalizeName(c.name) === h)
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) return null

  const first = h.split(' ')[0]!
  const byFirst = contacts.filter((c) => normalizeName(c.name).split(' ')[0] === first)
  if (byFirst.length === 1) return byFirst[0]!
  if (byFirst.length > 1) return null

  return pick((n) => n.startsWith(h) || h.startsWith(n))
}

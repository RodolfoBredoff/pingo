/** E.164 com "+" e 10 a 15 dígitos. */
export const E164 = /^\+\d{10,15}$/

/**
 * A Meta às vezes entrega celulares do Brasil sem o 9º dígito (ex.: 55 41 8888 7777).
 * Guardamos sempre a forma com o 9 (55 41 98888 7777) para o app e a lista combinarem.
 */
export function canonicalPhone(phone: string): string {
  const m = /^\+55(\d{2})([6-9]\d{7})$/.exec(phone)
  return m ? `+55${m[1]}9${m[2]}` : phone
}

/** O número recebido do webhook (só dígitos) vira E.164 canônico. */
export function fromWaId(waId: string): string {
  return canonicalPhone(`+${waId.replace(/\D/g, '')}`)
}

/** Para enviar, a Meta aceita o número com ou sem "+". Mandamos só dígitos. */
export function toWaId(phone: string): string {
  return phone.replace(/\D/g, '')
}

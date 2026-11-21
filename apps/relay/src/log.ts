import type { Logger } from './ports'

/**
 * Log em JSON, uma linha por evento. REGRA: nunca registrar texto de mensagem, telefone completo,
 * token ou segredo. Use só ids, tipos, contagens e códigos de status.
 */
export function createLogger(scope: string): Logger {
  const write = (level: string, msg: string, fields?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level, scope, msg, ...fields }))
  return {
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  }
}

/** "+5511988887777" → "+55…7777": suficiente para depurar sem expor o número. */
export function maskPhone(phone: string): string {
  return phone.length > 7 ? `${phone.slice(0, 3)}…${phone.slice(-4)}` : '…'
}

import { eq } from 'drizzle-orm'
import type { PingoDb } from '../db/client'
import { assignments, contacts, items } from '../db/schema'
import { normalizeName } from './contacts-match'
import type { ContactRow } from './items'

/**
 * Normaliza telefones para o formato internacional (+55…). Assume Brasil quando o
 * número vem sem código do país. Devolve null se não parecer um telefone.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return `+${digits}`
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`
  return `+${digits}`
}

export type AddContactResult =
  { ok: true; contact: ContactRow } | { ok: false; error: 'name' | 'phone' | 'duplicate' }

export async function addContact(
  db: PingoDb,
  name: string,
  rawPhone: string,
): Promise<AddContactResult> {
  const cleanName = name.replace(/\s+/g, ' ').trim().slice(0, 40)
  if (!cleanName) return { ok: false, error: 'name' }
  const phone = normalizePhone(rawPhone)
  if (!phone) return { ok: false, error: 'phone' }
  const existing = await db.select().from(contacts).where(eq(contacts.phone, phone)).get()
  if (existing) return { ok: false, error: 'duplicate' }
  const contact: ContactRow = {
    id: crypto.randomUUID(),
    name: cleanName,
    phone,
    optInAt: null,
    status: 'pending',
  }
  await db.insert(contacts).values(contact)
  return { ok: true, contact }
}

export async function listContacts(db: PingoDb): Promise<ContactRow[]> {
  return db.select().from(contacts)
}

export async function removeContact(db: PingoDb, id: string): Promise<void> {
  // Os itens continuam com o dono; o histórico de ofertas daquele contato é apagado junto.
  await db.update(items).set({ assigneeContactId: null }).where(eq(items.assigneeContactId, id))
  await db.delete(assignments).where(eq(assignments.contactId, id))
  await db.delete(contacts).where(eq(contacts.id, id))
}

export function findContactByName(all: ContactRow[], name: string): ContactRow | undefined {
  const n = normalizeName(name)
  return (
    all.find((c) => normalizeName(c.name) === n) ??
    all.find((c) => normalizeName(c.name).startsWith(n))
  )
}

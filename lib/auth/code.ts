import { createHmac, randomInt } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'

/**
 * No O/0, I/1/L, S/5, or vowels. A buyer reads this off an email or a WhatsApp
 * message and retypes it, often on a phone — every ambiguous glyph is a support
 * message. Dropping vowels also stops the generator producing a real word.
 */
const ALPHABET = 'BCDFGHJKMNPQRTVWXYZ23456789'

/** `FOT-7K2M-4QX9`. The dashes are cosmetic; `normalizeCode` strips them. */
export function generateCode(): string {
  const pick = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  return `FOT-${pick()}-${pick()}`
}

/**
 * Accept the code in whatever shape it arrives: `fot-2k9x-4m7p`,
 * `FOT 2K9X 4M7P` and `FOT2K9X4M7P` are the same credential.
 */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * A deterministic, indexed lookup key — nothing more. argon2 is unsearchable by
 * design, so a single-field login has no other way to find its row without
 * verifying every hash in the table. Possessing this value must never be
 * treated as proof of anything; `verifyCode` still does the real work.
 */
export function codeIndex(raw: string): string {
  const pepper = process.env.LOGIN_CODE_PEPPER
  if (!pepper) throw new Error('LOGIN_CODE_PEPPER is not set')
  return createHmac('sha256', pepper).update(normalizeCode(raw)).digest('hex')
}

// OWASP's argon2id baseline. 19 MiB keeps it inside a small serverless function.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

export function hashCode(raw: string): Promise<string> {
  return hash(normalizeCode(raw), ARGON)
}

export async function verifyCode(stored: string, raw: string): Promise<boolean> {
  try {
    return await verify(stored, normalizeCode(raw))
  } catch {
    return false
  }
}

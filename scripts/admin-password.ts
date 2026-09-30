/**
 * Prints the ADMIN_PASSWORD_HASH value for a password typed at the prompt.
 *
 *   pnpm admin:password
 *
 * Read from the terminal rather than an argument so the password never lands
 * in shell history. The output is base64 of an argon2id hash — safe to paste
 * into Vercel or `.env.local`, where a raw hash's `$` signs would be expanded.
 */
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { hash } from '@node-rs/argon2'

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

function ask(question: string): Promise<string> {
  let muted = false
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk)
      done()
    },
  })
  const rl = createInterface({ input: process.stdin, output, terminal: true })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
    muted = true
  })
}

// Wrapped: tsx runs these scripts as CommonJS, which has no top-level await.
async function main() {
  const password = await ask('Admin password (hidden): ')
  if (password.length < 12) {
    console.error('Use at least 12 characters.')
    process.exit(1)
  }
  if ((await ask('Again: ')) !== password) {
    console.error('The two did not match.')
    process.exit(1)
  }

  const encoded = Buffer.from(await hash(password, ARGON)).toString('base64')
  console.log(`\nADMIN_PASSWORD_HASH=${encoded}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

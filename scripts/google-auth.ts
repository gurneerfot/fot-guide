/**
 * One-time: signs the owner's Google account in and prints GOOGLE_REFRESH_TOKEN.
 *
 *   pnpm google:auth
 *
 * Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from a "Desktop app" OAuth
 * client (Google Cloud → APIs & Services → Credentials). Desktop clients accept
 * any loopback port as a redirect, so this listens on a random local port and
 * catches Google's redirect itself — nothing to register in the console.
 *
 * Sign in as the account whose calendar should hold the demo calls. Re-run it
 * if slot creation ever reports that Google sign-in expired.
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

const clientId = process.env.GOOGLE_CLIENT_ID
const clientSecret = process.env.GOOGLE_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.')
  process.exit(1)
}

const state = randomBytes(16).toString('hex')

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname !== '/callback') {
    res.writeHead(404).end()
    return
  }
  const code = url.searchParams.get('code')
  if (url.searchParams.get('state') !== state || !code) {
    res.writeHead(400).end(`Sign-in failed: ${url.searchParams.get('error') ?? 'bad state'}`)
    return
  }

  const { port } = server.address() as AddressInfo
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `http://127.0.0.1:${port}/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const body = (await response.json()) as { refresh_token?: string; error?: string }

  if (!body.refresh_token) {
    res.writeHead(500).end('No refresh token returned — see the terminal.')
    console.error('\nGoogle did not return a refresh token:', body)
    console.error('Remove the app at https://myaccount.google.com/permissions and run this again.')
  } else {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Done. You can close this tab.')
    console.log(`\nGOOGLE_REFRESH_TOKEN=${body.refresh_token}\n`)
    console.log('Put that in Vercel (and .env.local if you want slots created locally). Keep it secret.')
  }
  server.close()
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address() as AddressInfo
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `http://127.0.0.1:${port}/callback`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    // offline + consent: the only combination that reliably returns a refresh token.
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString()
  console.log('Open this in a browser and sign in as the account that will host the calls:\n')
  console.log(auth.toString())
})

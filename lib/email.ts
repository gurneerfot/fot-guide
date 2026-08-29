/**
 * Access-code delivery over Resend's HTTP API. No SDK — it is one POST.
 *
 * Every function here is best-effort and never throws into a caller. A payment
 * that succeeded must not be reported as failed because an email bounced; the
 * success screen shows the code too, and a send failure is logged for the owner
 * to follow up rather than surfaced to the buyer mid-purchase.
 */

import { purchaseMessage, whatsappUrl } from '@/lib/contact'

const API = 'https://api.resend.com/emails'

type SendResult = { sent: boolean; reason?: string }

async function send(input: {
  to: string
  subject: string
  html: string
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!key || !from) {
    // Expected before email is configured. The code still reaches the buyer on
    // the success screen, so this is a warning, not an error.
    console.warn('[email] RESEND_API_KEY / EMAIL_FROM not set — skipping send to', input.to)
    return { sent: false, reason: 'not-configured' }
  }

  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html }),
    })
    if (!response.ok) {
      console.error('[email] send failed', response.status, await response.text())
      return { sent: false, reason: `http-${response.status}` }
    }
    return { sent: true }
  } catch (error) {
    console.error('[email] send threw', error)
    return { sent: false, reason: 'threw' }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function shell(body: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
              background:#F8F5F0;padding:32px 16px;color:#16243F;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E2DCD2;border-radius:4px;padding:32px;">
    ${body}
    <hr style="border:none;border-top:1px solid #E2DCD2;margin:28px 0;">
    <p style="font-size:13px;color:#5A6980;margin:0;">
      Français on Tips — Learn · Practice · Succeed
    </p>
  </div>
</div>`
}

/**
 * One order, one email.
 *
 * A basket can hold material to read and services delivered by a person, so
 * this covers both in a single message rather than sending two that arrive
 * seconds apart and contradict each other about what happens next.
 */
export function sendOrderConfirmation(input: {
  to: string
  name: string
  /** Plaintext, and only for a brand-new account. Null means do not show one. */
  code: string | null
  readerTitles: string[]
  serviceTitles: string[]
  readUrl: string
}): Promise<SendResult> {
  const list = (titles: string[]) =>
    titles.map((t) => `<li style="margin:0 0 6px;">${escapeHtml(t)}</li>`).join('')

  const codeBlock = input.code
    ? `<p style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:26px;letter-spacing:2px;
                font-weight:700;background:#F8F5F0;border:1px solid #E2DCD2;border-radius:4px;
                padding:16px;text-align:center;margin:0 0 20px;">${escapeHtml(input.code)}</p>
       <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">
         Enter it at the link below to start reading.
       </p>
       <a href="${escapeHtml(input.readUrl)}"
          style="display:inline-block;background:#2B4C9B;color:#fff;text-decoration:none;
                 padding:12px 22px;border-radius:4px;font-weight:600;">Open my study material</a>
       <p style="font-size:14px;line-height:1.6;color:#5A6980;margin:24px 0 0;">
         Keep this code private. It works on one device at a time — signing in
         somewhere new will sign you out everywhere else.
       </p>`
    : `<p style="font-size:16px;line-height:1.6;margin:0 0 24px;">
         This has been added to your existing account. Sign in with the access
         code you already have — it has not changed.
       </p>
       <a href="${escapeHtml(input.readUrl)}"
          style="display:inline-block;background:#2B4C9B;color:#fff;text-decoration:none;
                 padding:12px 22px;border-radius:4px;font-weight:600;">Open my library</a>
       <p style="font-size:14px;line-height:1.6;color:#5A6980;margin:24px 0 0;">
         Lost your code? Reply to this email and we will issue a new one.
       </p>`

  const readerBlock = input.readerTitles.length
    ? `<h2 style="font-size:16px;margin:28px 0 10px;">To read online</h2>
       <ul style="font-size:16px;line-height:1.6;margin:0 0 20px;padding-left:20px;">${list(input.readerTitles)}</ul>
       ${codeBlock}`
    : ''

  const serviceBlock = input.serviceTitles.length
    ? `<h2 style="font-size:16px;margin:28px 0 10px;">Next step</h2>
       <ul style="font-size:16px;line-height:1.6;margin:0 0 16px;padding-left:20px;">${list(input.serviceTitles)}</ul>
       <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">
         Message us on WhatsApp to arrange it. The link below opens a chat with
         your purchase already written out, so we know who you are straight away.
       </p>
       <a href="${escapeHtml(whatsappUrl(purchaseMessage(input.serviceTitles)))}"
          style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;
                 padding:12px 22px;border-radius:4px;font-weight:600;">Message us on WhatsApp</a>
       <p style="font-size:14px;line-height:1.6;color:#5A6980;margin:20px 0 0;">
         There is no access code for these — they are not something you open here.
       </p>`
    : ''

  const body = `
    <h1 style="font-size:22px;margin:0 0 16px;">Bonjour ${escapeHtml(input.name)},</h1>
    <p style="font-size:16px;line-height:1.6;margin:0;">
      Your purchase was successful. Thank you.
    </p>
    ${readerBlock}${serviceBlock}`

  return send({ to: input.to, subject: 'Your purchase is confirmed', html: shell(body) })
}

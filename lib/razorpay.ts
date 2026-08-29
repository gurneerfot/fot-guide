import { createHmac, timingSafeEqual } from 'node:crypto'
import { CURRENCY } from '@/lib/money'

/**
 * No SDK. Order creation is one authenticated POST and signature verification
 * is an HMAC — the official package wraps both thinly and ships weak types, so
 * `fetch` plus `node:crypto` is less code and less to audit.
 */

const API = 'https://api.razorpay.com/v1'

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set')
  return { keyId, keySecret }
}

export type RazorpayOrder = {
  id: string
  amount: number
  currency: string
  receipt: string | null
  status: string
}

/**
 * The amount is always computed by the caller from a database row, never taken
 * from the request body. A client-supplied price is how a CA$25 book gets
 * bought for CA$0.01.
 *
 * Charging in CAD requires International Payments to be enabled on the Razorpay
 * account (Dashboard → Settings → Configuration). Without it Razorpay rejects
 * the order with a currency error rather than falling back to INR, which is the
 * right failure — a silent fallback would charge ₹25 for a CA$25 product.
 */
export async function createOrder(input: {
  amountCents: number
  receipt: string
  notes?: Record<string, string>
}): Promise<RazorpayOrder> {
  const { keyId, keySecret } = credentials()
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')

  const response = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      // Minor units, as everywhere else in Razorpay's API — cents for CAD.
      amount: input.amountCents,
      currency: CURRENCY,
      receipt: input.receipt,
      notes: input.notes ?? {},
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Razorpay order failed (${response.status}): ${detail}`)
  }
  return (await response.json()) as RazorpayOrder
}

function hmacHex(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/** Length-safe constant-time compare. `timingSafeEqual` throws on a length mismatch. */
function matches(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Verifies a webhook against the raw request body.
 *
 * The body must be the exact bytes Razorpay sent. `JSON.parse` followed by
 * `JSON.stringify` reorders keys and drops whitespace, which changes the digest
 * and fails every signature — read the text first, verify, then parse.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set')
  if (!signature) return false
  return matches(hmacHex(rawBody, secret), signature)
}

/**
 * Verifies the handoff the browser reports after Checkout closes.
 *
 * Used only to decide which screen to show. Entitlement is granted by the
 * webhook and nowhere else — this value reaches us through the buyer's own
 * browser, so it can be replayed or withheld and must never be the thing that
 * unlocks content.
 */
export function verifyCheckoutSignature(input: {
  orderId: string
  paymentId: string
  signature: string
}): boolean {
  const { keySecret } = credentials()
  return matches(hmacHex(`${input.orderId}|${input.paymentId}`, keySecret), input.signature)
}

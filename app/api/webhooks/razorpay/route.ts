import { NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/razorpay'
import { baseUrlFrom, settlePayment } from '@/lib/settle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The authoritative path to access. It runs server-to-server, so it works when
 * the buyer closes the tab on the payment screen, loses signal, or never comes
 * back — cases where the browser confirm never fires and which are otherwise
 * exactly the ones that turn into "I paid and got nothing".
 *
 * Configure in the Razorpay dashboard for `payment.captured`, pointed at
 * https://<host>/api/webhooks/razorpay with the same secret as
 * RAZORPAY_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  // The raw bytes, before any parsing. Round-tripping through JSON reorders
  // keys and strips whitespace, which changes the digest and fails every
  // signature check.
  const raw = await request.text()

  let valid: boolean
  try {
    valid = verifyWebhookSignature(raw, request.headers.get('x-razorpay-signature'))
  } catch (error) {
    console.error('[webhook] not configured', error)
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }
  if (!valid) {
    // 400, not 500: Razorpay retries 5xx, and a bad signature will never pass
    // on a retry. Anything reaching here is misconfigured or forged.
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  let event: {
    event?: string
    payload?: { payment?: { entity?: { id?: string; order_id?: string } } }
  }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'malformed payload' }, { status: 400 })
  }

  if (event.event !== 'payment.captured') {
    // Acknowledged so Razorpay stops resending an event we do not act on.
    return NextResponse.json({ ok: true, ignored: event.event ?? 'unknown' })
  }

  const entity = event.payload?.payment?.entity
  if (!entity?.id || !entity.order_id) {
    return NextResponse.json({ error: 'payment entity missing ids' }, { status: 400 })
  }

  try {
    const result = await settlePayment({
      razorpayOrderId: entity.order_id,
      razorpayPaymentId: entity.id,
      baseUrl: baseUrlFrom(request),
    })

    if (result.status === 'unknown-order') {
      // Someone else's order, or one from a database that has since been reset.
      // A 200 stops the retries; a 500 would have Razorpay resend it for days.
      console.warn('[webhook] no local payment for order', entity.order_id)
      return NextResponse.json({ ok: true, unknownOrder: true })
    }
    return NextResponse.json({ ok: true, status: result.status })
  } catch (error) {
    // A real failure on our side. 500 asks Razorpay to retry, which is what we
    // want — the buyer has paid and has no access yet.
    console.error('[webhook] settlement failed', error)
    return NextResponse.json({ error: 'settlement failed' }, { status: 500 })
  }
}

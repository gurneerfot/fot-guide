import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyCheckoutSignature } from '@/lib/razorpay'
import { baseUrlFrom, settlePayment } from '@/lib/settle'

export const runtime = 'nodejs'

const body = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(256),
})

/**
 * The fast path, so the code is on screen the moment Checkout closes rather
 * than whenever the webhook lands.
 *
 * The signature is HMAC(order_id|payment_id) under the key secret, which only
 * Razorpay can produce — so this is proof the payment happened, not merely a
 * browser claiming it did. It is still not the authoritative path: the webhook
 * runs regardless, and both go through the same idempotent settlement, so a
 * buyer who never gets here is provisioned anyway.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Malformed confirmation.' }, { status: 400 })
  }
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data

  let valid: boolean
  try {
    valid = verifyCheckoutSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })
  } catch (error) {
    console.error('[confirm] not configured', error)
    return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })
  }
  if (!valid) {
    return NextResponse.json({ error: 'Could not verify that payment.' }, { status: 400 })
  }

  const result = await settlePayment({
    razorpayOrderId: razorpay_order_id,
    razorpayPaymentId: razorpay_payment_id,
    baseUrl: baseUrlFrom(request),
  })

  switch (result.status) {
    case 'settled':
      // `code` is plaintext here and nowhere else — it is argon2-hashed at
      // rest, so if the buyer loses this screen it has to be reissued, not read.
      return NextResponse.json({
        status: 'settled',
        email: result.email,
        code: result.code,
        readerTitles: result.readerTitles,
        serviceTitles: result.serviceTitles,
      })

    case 'already-settled':
      // The webhook beat this call. Whatever was owed has been sent, and a
      // brand-new code cannot be reprinted here — so point at the inbox rather
      // than guess what the buyer received.
      return NextResponse.json({ status: 'already-settled', email: result.email })

    default:
      console.error('[confirm] unexpected settlement state', result.status, razorpay_order_id)
      return NextResponse.json(
        { error: 'Payment received, but access is still being set up. Check your email.' },
        { status: 202 },
      )
  }
}

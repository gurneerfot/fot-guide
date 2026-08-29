import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, paymentItems, payments, products } from '@/db'
import { createOrder } from '@/lib/razorpay'

export const runtime = 'nodejs'

/**
 * Every field carries its own message, including for the absent case: the first
 * issue is what the buyer is shown, and Zod's default ("expected string,
 * received undefined") is an internal detail nobody outside this file should
 * ever read.
 */
const body = z.object({
  // A set, not a list: the cart holds one of each, and duplicates would double
  // the total for nothing. Deduplicated here rather than trusted from the client.
  slugs: z
    .array(z.string().min(1).max(120), { error: 'Your cart is empty.' })
    .min(1, 'Your cart is empty.')
    .max(20),
  name: z.string({ error: 'Enter your name.' }).trim().min(2, 'Enter your name.').max(80),
  email: z.email('Enter a valid email address.').max(160),
  /**
   * Required. A mock test or a lesson plan is delivered by a person getting in
   * touch, so an order with no way to reach the buyer is one that cannot be
   * fulfilled — and that is only discovered after the money has been taken.
   *
   * Deliberately not format-matched beyond this: buyers are international, and
   * a regex tight enough to be meaningful rejects real numbers. Counting digits
   * catches the empty and the obviously-not-a-number without guessing at plans.
   */
  phone: z
    .string({ error: 'Enter your phone number.' })
    .trim()
    .min(1, 'Enter your phone number.')
    .max(20)
    .regex(/^[+()\d\s.-]+$/, 'Enter a valid phone number.')
    .refine((v) => (v.match(/\d/g) ?? []).length >= 7, 'Enter a valid phone number.'),
})

/**
 * Opens a Razorpay order for everything in the cart.
 *
 * The request body carries which products and who is buying — never what they
 * cost. Every price is read back from its row and the total summed here, because
 * a client-supplied amount is how a CA$28 book gets bought for one cent.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' },
      { status: 400 },
    )
  }
  const { name, email, phone } = parsed.data
  const slugs = [...new Set(parsed.data.slugs)]

  const rows = await db.select().from(products).where(inArray(products.slug, slugs))
  const available = rows.filter((row) => row.isActive)

  // All or nothing. Silently dropping a withdrawn item would charge for a
  // basket the buyer never agreed to.
  if (available.length !== slugs.length) {
    const missing = slugs.filter((slug) => !available.some((row) => row.slug === slug))
    return NextResponse.json(
      {
        error:
          missing.length === 1
            ? 'One item in your cart is no longer available. Please remove it and try again.'
            : 'Some items in your cart are no longer available. Please refresh and try again.',
        unavailable: missing,
      },
      { status: 409 },
    )
  }

  const keyId = process.env.RAZORPAY_KEY_ID
  if (!keyId) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 })
  }

  // Prices are all-in: this total is exactly what the card is charged.
  const amountCents = available.reduce((sum, row) => sum + row.priceCents, 0)

  // The id is minted here so it can be the Razorpay receipt, which means the
  // order carries our primary key and a support query can go either direction.
  const paymentId = randomUUID()

  // Razorpay first, then our rows. The reverse would need a placeholder order
  // id, and `razorpay_order_id` is uniquely indexed — two people checking out at
  // the same second would collide on it. An unpaid order left behind by a failed
  // insert costs nothing and expires on its own.
  let order
  try {
    order = await createOrder({
      amountCents,
      receipt: paymentId,
      notes: { items: available.map((row) => row.slug).join(','), buyerEmail: email },
    })
  } catch (error) {
    console.error('[checkout] order creation failed', error)
    return NextResponse.json(
      { error: 'Could not start the payment. Please try again.' },
      { status: 502 },
    )
  }

  // Written before the buyer reaches the Razorpay modal, so an abandoned
  // checkout leaves a trace instead of nothing at all. One transaction, because
  // an order with no lines would settle as an empty basket.
  await db.transaction(async (tx) => {
    await tx.insert(payments).values({
      id: paymentId,
      email,
      name,
      phone,
      amountCents,
      razorpayOrderId: order.id,
      status: 'created',
    })
    await tx.insert(paymentItems).values(
      available.map((row) => ({
        paymentId,
        productId: row.id,
        unitPriceCents: row.priceCents,
      })),
    )
  })

  return NextResponse.json({
    orderId: order.id,
    amountCents,
    keyId,
    description:
      available.length === 1 ? available[0].title : `${available.length} items`,
    prefill: { name, email, contact: phone ?? '' },
  })
}

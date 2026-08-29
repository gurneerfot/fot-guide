import { eq, sql } from 'drizzle-orm'
import { db, entitlements, payments, users } from '@/db'
import { accessCodeExpiry, codeIndex, generateCode, hashCode } from '@/lib/auth/code'

/**
 * Turns a captured payment into whatever it bought.
 *
 * Reachable from two directions — the Razorpay webhook (reliable, survives the
 * buyer closing the tab) and the browser confirm call (fast, so the code is on
 * screen immediately). Both can arrive at once, so everything here is
 * idempotent and the payment row is locked for the duration.
 *
 * An order is a basket. It can hold material hosted here, services delivered by
 * a person, or both, and the two are fulfilled independently: reader items grant
 * an entitlement, service items grant nothing and are handed to the team.
 */

/** This call did the work, and therefore owes the buyer exactly one email. */
export type SettledOrder = {
  status: 'settled'
  email: string
  name: string
  phone: string | null
  /**
   * Plaintext when this order created the account or replaced an expired code —
   * the only moments it is readable. Null for a repeat buyer whose existing
   * code still works, and for a basket with nothing to read in it.
   */
  code: string | null
  /** Titles, for the email. Empty when the basket held no material. */
  readerTitles: string[]
  serviceTitles: string[]
}

export type ProvisionResult =
  | SettledOrder
  /**
   * Someone else already settled this — the other half of the webhook/confirm
   * race, or a webhook Razorpay retried. Send nothing.
   */
  | { status: 'already-settled'; email: string; name: string }
  | { status: 'not-paid' }
  | { status: 'unknown-order' }

/**
 * Generates a code that no existing row uses. The retry loop is for the
 * vanishingly unlikely collision — 27^8 combinations — not for correctness;
 * the unique index is what actually guarantees it.
 */
async function uniqueCode(): Promise<{ code: string; index: string; hash: string }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateCode()
    const index = codeIndex(code)
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.codeIndex, index))
      .limit(1)
    if (!clash) return { code, index, hash: await hashCode(code) }
  }
  throw new Error('could not generate a unique access code')
}

type LockedPayment = {
  id: string
  user_id: string | null
  email: string
  name: string
  phone: string | null
  status: string
  provisioned_at: Date | null
}

type OrderLine = { product_id: string; kind: 'reader' | 'service'; title: string }

export async function provisionPayment(razorpayOrderId: string): Promise<ProvisionResult> {
  return db.transaction(async (tx) => {
    // FOR UPDATE serialises the webhook and the browser confirm when they land
    // together — without it both read `provisioned_at IS NULL` and both issue a
    // code, and the buyer gets two different ones.
    const locked = await tx.execute(
      sql`select id, user_id, email, name, phone, status, provisioned_at
          from payments where razorpay_order_id = ${razorpayOrderId} for update`,
    )
    const row = locked.rows[0] as LockedPayment | undefined

    if (!row) return { status: 'unknown-order' }
    if (row.status !== 'paid') return { status: 'not-paid' }

    // The work is done. Whether that was a millisecond ago by the webhook or
    // last week by a retry, there is nothing to grant and nothing to send.
    if (row.provisioned_at) {
      return { status: 'already-settled', email: row.email, name: row.name }
    }

    const lines = await tx.execute(
      sql`select pi.product_id, pr.kind, pr.title
          from payment_items pi
          join products pr on pr.id = pi.product_id
          where pi.payment_id = ${row.id}
          order by pr.kind, pr.title`,
    )
    const items = lines.rows as OrderLine[]

    const readerItems = items.filter((i) => i.kind === 'reader')
    const serviceItems = items.filter((i) => i.kind === 'service')

    let userId = row.user_id
    let code: string | null = null

    // Only material hosted here needs an account. A basket of services alone
    // creates none, because there would be nothing for that login to open.
    if (readerItems.length > 0) {
      // A repeat buyer keeps one account and one code; a second code would mean
      // two logins for one person and a support message asking which is which.
      const [existing] = await tx
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = lower(${row.email})`)
        .limit(1)

      if (existing) {
        userId = existing.id
        if (existing.accessExpiresAt <= new Date()) {
          const fresh = await uniqueCode()
          code = fresh.code
          await tx
            .update(users)
            .set({
              codeIndex: fresh.index,
              codeHash: fresh.hash,
              accessExpiresAt: accessCodeExpiry(),
            })
            .where(eq(users.id, existing.id))
        }
      } else {
        const fresh = await uniqueCode()
        code = fresh.code
        const [created] = await tx
          .insert(users)
          .values({
            codeIndex: fresh.index,
            codeHash: fresh.hash,
            name: row.name,
            email: row.email,
            phone: row.phone,
          })
          .returning()
        userId = created.id
      }

      // Buying the same thing twice grants nothing new, so the conflict is a
      // no-op rather than an error the webhook would retry forever.
      await tx
        .insert(entitlements)
        .values(
          readerItems.map((item) => ({
            userId: userId as string,
            productId: item.product_id,
            paymentId: row.id,
          })),
        )
        .onConflictDoNothing({ target: [entitlements.userId, entitlements.productId] })
    }

    await tx
      .update(payments)
      .set({ userId, provisionedAt: new Date(), updatedAt: new Date() })
      .where(eq(payments.id, row.id))

    return {
      status: 'settled',
      email: row.email,
      name: row.name,
      phone: row.phone,
      code,
      readerTitles: readerItems.map((i) => i.title),
      serviceTitles: serviceItems.map((i) => i.title),
    }
  })
}

/**
 * Records the capture. Separate from provisioning so the two can be reasoned
 * about independently: this is the money, that is the account.
 *
 * `razorpay_payment_id` is uniquely indexed, so a retried webhook that races
 * the browser confirm hits the constraint instead of writing twice.
 */
export async function markPaid(
  razorpayOrderId: string,
  razorpayPaymentId: string,
): Promise<boolean> {
  const updated = await db
    .update(payments)
    .set({ status: 'paid', razorpayPaymentId, updatedAt: new Date() })
    .where(eq(payments.razorpayOrderId, razorpayOrderId))
    .returning({ id: payments.id })
  return updated.length > 0
}

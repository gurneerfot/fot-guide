/**
 * Exercises the purchase-to-access path against whatever DATABASE_URL points
 * at, and DELETES EVERY ROW in the process. Point it at a scratch database.
 *
 *   pnpm check
 *
 * Worth re-running after any change to provisioning, entitlement or the login
 * code: the concurrency and idempotency cases below are the ones that quietly
 * turn into a buyer paying twice or receiving two different access codes.
 */
import { eq, sql } from 'drizzle-orm'
import {
  db,
  entitlements,
  materialPages,
  pageViews,
  paymentItems,
  payments,
  products,
  users,
} from '../db'
import { codeIndex, verifyCode } from '../lib/auth/code'
import { markPaid, provisionPayment } from '../lib/provision'
import { hasAccess } from '../lib/entitlement'

let failures = 0
function check(label: string, condition: boolean, detail = '') {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures++
}

/** Places an order the way `/api/checkout` does: one payment, N lines. */
async function order(input: {
  razorpayOrderId: string
  email: string
  name: string
  phone?: string
  productIds: { id: string; priceCents: number }[]
}) {
  const amountCents = input.productIds.reduce((sum, p) => sum + p.priceCents, 0)
  const [payment] = await db
    .insert(payments)
    .values({
      email: input.email,
      name: input.name,
      phone: input.phone,
      amountCents,
      razorpayOrderId: input.razorpayOrderId,
    })
    .returning()
  await db.insert(paymentItems).values(
    input.productIds.map((p) => ({
      paymentId: payment.id,
      productId: p.id,
      unitPriceCents: p.priceCents,
    })),
  )
  return payment
}

async function main() {
  // Clean slate
  await db.delete(pageViews)
  await db.delete(entitlements)
  await db.delete(paymentItems)
  await db.delete(payments)
  await db.delete(materialPages)
  await db.delete(users)
  await db.delete(products)

  const [guide] = await db
    .insert(products)
    .values({
      slug: 'tef-guide',
      title: 'TEF Guide',
      kind: 'reader',
      priceCents: 2800,
      pageCount: 3,
      isActive: true,
    })
    .returning()
  const [mockReading] = await db
    .insert(products)
    .values({ slug: 'mock-reading', title: 'Mock — Reading', kind: 'service', priceCents: 2800 })
    .returning()
  const [mockListening] = await db
    .insert(products)
    .values({ slug: 'mock-listening', title: 'Mock — Listening', kind: 'service', priceCents: 2800 })
    .returning()

  console.log('\n1. First purchase — one reader item')
  await order({
    razorpayOrderId: 'order_AAA',
    email: 'Priya@Example.com',
    name: 'Priya S',
    productIds: [guide],
  })

  const notPaid = await provisionPayment('order_AAA')
  check('unpaid order is refused', notPaid.status === 'not-paid', notPaid.status)

  await markPaid('order_AAA', 'pay_AAA')
  const first = await provisionPayment('order_AAA')
  check('first provision settles', first.status === 'settled', first.status)
  const code = first.status === 'settled' ? (first.code ?? '') : ''
  check('a code was issued', Boolean(code))
  check(
    'the reader title is reported for the email',
    first.status === 'settled' && first.readerTitles.length === 1,
  )
  console.log(`       code: ${code}`)

  console.log('\n2. Idempotency — webhook retry')
  const again = await provisionPayment('order_AAA')
  check('second provision does not reissue', again.status === 'already-settled', again.status)
  const userCount1 = await db.select({ n: sql<number>`count(*)::int` }).from(users)
  check('still exactly one user', userCount1[0].n === 1, `${userCount1[0].n}`)

  console.log('\n3. Concurrent webhook + browser confirm')
  await order({
    razorpayOrderId: 'order_BBB',
    email: 'raj@example.com',
    name: 'Raj K',
    productIds: [guide],
  })
  await markPaid('order_BBB', 'pay_BBB')
  const racers = await Promise.all([
    provisionPayment('order_BBB'),
    provisionPayment('order_BBB'),
    provisionPayment('order_BBB'),
  ])
  const settled = racers.filter((r) => r.status === 'settled')
  check('exactly one of three concurrent calls settles', settled.length === 1, `${settled.length}`)
  // The losers must report `already-settled`: the caller emails on `settled`,
  // so confusing the two sends the buyer a second, contradictory message.
  const silent = racers.filter((r) => r.status === 'already-settled')
  check('the other two are told to send nothing', silent.length === 2, `${silent.length} silent`)
  const rajUsers = await db.select().from(users).where(sql`lower(${users.email}) = 'raj@example.com'`)
  check('exactly one account created', rajUsers.length === 1, `${rajUsers.length}`)

  console.log('\n4. Login with the issued code')
  const [found] = await db.select().from(users).where(eq(users.codeIndex, codeIndex(code)))
  check('code index finds the buyer', Boolean(found), found?.email)
  check('argon2 verifies the code', found ? await verifyCode(found.codeHash, code) : false)
  check(
    'lowercase + no dashes still works',
    found ? await verifyCode(found.codeHash, code.toLowerCase().replace(/-/g, '')) : false,
  )
  check('a wrong code is rejected', found ? !(await verifyCode(found.codeHash, 'FOT-0000-0000')) : false)

  console.log('\n5. Entitlement gating')
  check('buyer can read what they bought', await hasAccess(found.id, guide.id))
  const [outsider] = await db
    .insert(users)
    .values({ codeIndex: 'x'.repeat(64), codeHash: 'x', name: 'Nobody', email: 'nobody@example.com' })
    .returning()
  check('a non-buyer cannot', !(await hasAccess(outsider.id, guide.id)))

  console.log('\n6. Repeat buyer — same email, second order')
  await order({
    razorpayOrderId: 'order_CCC',
    email: 'PRIYA@example.com', // different casing on purpose
    name: 'Priya S',
    productIds: [guide],
  })
  await markPaid('order_CCC', 'pay_CCC')
  const repeat = await provisionPayment('order_CCC')
  check('repeat buyer settles', repeat.status === 'settled', repeat.status)
  check('repeat buyer gets no second code', repeat.status === 'settled' && repeat.code === null)
  const priyaRows = await db.select().from(users).where(sql`lower(${users.email}) = 'priya@example.com'`)
  check('case-insensitive email match — still one account', priyaRows.length === 1, `${priyaRows.length}`)

  console.log('\n7. Duplicate payment id is rejected by the database')
  let rejected = false
  try {
    await db.insert(payments).values({
      email: 'dupe@example.com',
      name: 'Dupe',
      amountCents: 2800,
      razorpayOrderId: 'order_DDD',
      razorpayPaymentId: 'pay_AAA', // already used
    })
  } catch {
    rejected = true
  }
  check('unique index blocks a reused razorpay_payment_id', rejected)

  console.log('\n8. Service-only order — no account, no entitlement')
  await order({
    razorpayOrderId: 'order_EEE',
    email: 'newbuyer@example.com',
    name: 'New Buyer',
    phone: '+1 555 0100',
    productIds: [mockReading],
  })
  await markPaid('order_EEE', 'pay_EEE')
  const service = await provisionPayment('order_EEE')
  check('service order settles', service.status === 'settled', service.status)
  check(
    'no code and no reader titles',
    service.status === 'settled' && service.code === null && service.readerTitles.length === 0,
  )
  check(
    'the service title and phone reach the follow-up alert',
    service.status === 'settled' &&
      service.serviceTitles.length === 1 &&
      service.phone === '+1 555 0100',
  )
  const newAccounts = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = 'newbuyer@example.com'`)
  check('no account is created for a service buyer', newAccounts.length === 0, `${newAccounts.length}`)

  console.log('\n9. Service settlement is idempotent')
  const serviceAgain = await provisionPayment('order_EEE')
  check(
    'a retried webhook sends no second confirmation',
    serviceAgain.status === 'already-settled',
    serviceAgain.status,
  )

  console.log('\n10. Mixed basket — guide + two mocks in one order')
  const mixed = await order({
    razorpayOrderId: 'order_FFF',
    email: 'cart@example.com',
    name: 'Cart Buyer',
    productIds: [guide, mockReading, mockListening],
  })
  check('order total is the sum of its lines', mixed.amountCents === 8400, `${mixed.amountCents}`)
  await markPaid('order_FFF', 'pay_FFF')
  const basket = await provisionPayment('order_FFF')
  check('mixed basket settles', basket.status === 'settled', basket.status)
  check(
    'a code is issued for the reader item',
    basket.status === 'settled' && Boolean(basket.code),
  )
  check(
    'both services are reported for follow-up',
    basket.status === 'settled' && basket.serviceTitles.length === 2,
    basket.status === 'settled' ? basket.serviceTitles.join(', ') : '',
  )
  const [cartUser] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = 'cart@example.com'`)
  check('an account was created', Boolean(cartUser))
  check('entitled to the guide', await hasAccess(cartUser.id, guide.id))
  // The whole point of the split: paying for a mock must not put a dead link in
  // their library.
  check('not entitled to the mock tests', !(await hasAccess(cartUser.id, mockReading.id)))
  const cartEntitlements = await db
    .select()
    .from(entitlements)
    .where(eq(entitlements.userId, cartUser.id))
  check('exactly one entitlement from a three-item basket', cartEntitlements.length === 1, `${cartEntitlements.length}`)

  console.log('\n11. The same product cannot appear twice on one order')
  let duplicateBlocked = false
  try {
    const [dupePayment] = await db
      .insert(payments)
      .values({
        email: 'dupe2@example.com',
        name: 'Dupe Two',
        amountCents: 5600,
        razorpayOrderId: 'order_GGG',
      })
      .returning()
    await db.insert(paymentItems).values([
      { paymentId: dupePayment.id, productId: guide.id, unitPriceCents: 2800 },
      { paymentId: dupePayment.id, productId: guide.id, unitPriceCents: 2800 },
    ])
  } catch {
    duplicateBlocked = true
  }
  check('unique index blocks a duplicated cart line', duplicateBlocked)

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * Owner CLI. Everything the storefront cannot do for itself.
 *
 *   pnpm grant --list
 *   pnpm grant --publish tef-guide
 *   pnpm grant --unpublish tef-guide
 *   pnpm grant --give someone@example.com --product tef-guide --name "Priya S"
 *   pnpm grant --reissue someone@example.com
 *   pnpm grant --payments
 *
 * A CLI rather than an admin page on purpose: these are rare, high-consequence
 * actions, and a login-protected web page that can hand out free access is a
 * bigger surface than a command only you can run.
 */
import { eq, sql } from 'drizzle-orm'
import { db, entitlements, products, users } from '../db'
import { codeIndex, generateCode, hashCode } from '../lib/auth/code'
import { formatCad, estimatedNetCents } from '../lib/money'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function uniqueCode() {
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

async function listProducts() {
  const rows = await db.select().from(products)
  if (!rows.length) return console.log('No products yet. Run `pnpm ingest` first.')
  for (const row of rows) {
    // Price is all-in; the net is what is likely to land after the gateway and
    // the currency conversion. An estimate — Razorpay's dashboard is the truth.
    console.log(
      `${row.isActive ? '● live  ' : '○ draft '} ${row.slug.padEnd(20)} ` +
        `${row.kind.padEnd(8)} ${formatCad(row.priceCents).padStart(10)} ` +
        `(net ~${formatCad(estimatedNetCents(row.priceCents)).padStart(10)})  ` +
        `${row.kind === 'reader' ? `${String(row.pageCount).padStart(4)}pp` : '    —'}  ${row.title}`,
    )
  }
}

/**
 * Creates a product nobody reads here — a mock test module or a lesson plan.
 *
 * `pnpm ingest` cannot make these because it exists to turn a PDF into pages,
 * and these have none. Re-running with the same slug updates the price and
 * title, matching how ingest behaves.
 */
async function addService(slug: string, title: string, priceCad: number, summary: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return console.error('--slug must be lowercase letters, digits and dashes')
  }
  if (!Number.isFinite(priceCad) || priceCad <= 0) {
    return console.error('--price must be a positive amount in Canadian dollars, e.g. 25')
  }
  const priceCents = Math.round(priceCad * 100)

  const [existing] = await db.select().from(products).where(eq(products.slug, slug)).limit(1)
  if (existing && existing.kind !== 'service') {
    // Flipping a reader product to a service would strand its pages and revoke
    // nothing — the buyers who already own it would silently lose the library
    // entry they paid for.
    return console.error(`"${slug}" already exists as a ${existing.kind} product.`)
  }

  if (existing) {
    await db
      .update(products)
      .set({ title, priceCents, ...(summary ? { summary } : {}) })
      .where(eq(products.id, existing.id))
    console.log(
      `Updated ${slug} — ${formatCad(priceCents)} (net ~${formatCad(estimatedNetCents(priceCents))}).`,
    )
    return
  }

  await db.insert(products).values({
    slug,
    title,
    summary,
    kind: 'service',
    priceCents,
    // Deliberately off, exactly as ingest leaves a book: read the copy on the
    // storefront before it can take money.
    isActive: false,
  })
  console.log(
    `Created draft ${slug} — ${formatCad(priceCents)} (net ~${formatCad(estimatedNetCents(priceCents))}).`,
  )
  console.log(`Publish with: pnpm grant --publish ${slug}`)
}

async function setPublished(slug: string, isActive: boolean) {
  const updated = await db
    .update(products)
    .set({ isActive })
    .where(eq(products.slug, slug))
    .returning({ title: products.title, pageCount: products.pageCount, kind: products.kind })
  if (!updated.length) return console.error(`No product with slug "${slug}"`)

  if (isActive && updated[0].kind === 'reader' && updated[0].pageCount === 0) {
    // Publishing an empty product means selling a book with no pages in it.
    await db.update(products).set({ isActive: false }).where(eq(products.slug, slug))
    return console.error(`"${slug}" has no pages. Run \`pnpm ingest\` before publishing.`)
  }
  console.log(`${updated[0].title} is now ${isActive ? 'LIVE' : 'a draft'}.`)
}

async function give(email: string, slug: string, name: string) {
  const [product] = await db.select().from(products).where(eq(products.slug, slug)).limit(1)
  if (!product) return console.error(`No product with slug "${slug}"`)
  if (product.kind === 'service') {
    // An entitlement to a service grants access to nothing — it would put a
    // dead link in their library. Whatever was promised is delivered by a
    // person, off this site.
    return console.error(
      `"${slug}" is a service product. There is nothing here to grant — arrange it directly.`,
    )
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1)

  let userId: string
  let code: string | null = null
  if (existing) {
    userId = existing.id
  } else {
    const fresh = await uniqueCode()
    code = fresh.code
    const [created] = await db
      .insert(users)
      .values({ codeIndex: fresh.index, codeHash: fresh.hash, name, email })
      .returning()
    userId = created.id
  }

  await db
    .insert(entitlements)
    .values({ userId, productId: product.id })
    .onConflictDoNothing({ target: [entitlements.userId, entitlements.productId] })

  console.log(`Granted "${product.title}" to ${email}.`)
  console.log(code ? `Access code: ${code}` : 'They keep their existing access code.')
}

/** For a buyer who lost their code. The old one stops working immediately —
 *  which is also how you cut off a code that has been passed around. */
async function reissue(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1)
  if (!user) return console.error(`No account for ${email}`)

  const fresh = await uniqueCode()
  await db
    .update(users)
    .set({ codeIndex: fresh.index, codeHash: fresh.hash })
    .where(eq(users.id, user.id))
  console.log(`New access code for ${user.name} <${user.email}>: ${fresh.code}`)
  console.log('Their previous code no longer works.')
}

async function listPayments() {
  // One row per order with its lines rolled up, rather than one row per line —
  // a basket of three should read as one payment, because it was one charge.
  const result = await db.execute(sql`
    select p.created_at, p.email, p.status, p.amount_cents, p.provisioned_at,
           string_agg(pr.title, ', ' order by pr.title) as titles,
           bool_or(pr.kind = 'service') as has_service
    from payments p
    left join payment_items pi on pi.payment_id = p.id
    left join products pr on pr.id = pi.product_id
    group by p.id
    order by p.created_at desc
    limit 50`)

  // Raw `db.execute` hands back what the driver gives it, and node-postgres
  // returns timestamptz as a string — only drizzle's query builder parses those
  // into Date. Typing these as Date would compile and then throw at runtime.
  const rows = result.rows as {
    created_at: string
    email: string
    status: string
    amount_cents: number
    provisioned_at: string | null
    titles: string | null
    has_service: boolean | null
  }[]

  if (!rows.length) return console.log('No payments yet.')
  for (const row of rows) {
    // A paid row with no provisioned_at is money taken without access given —
    // the one line in this output that needs acting on.
    const flag = row.status === 'paid' && !row.provisioned_at ? '  ⚠ NOT PROVISIONED' : ''
    // A settled service order is a person still waiting to be contacted. The
    // alert email says so at the time; this is how you find one that was missed.
    const followUp = row.has_service && row.status === 'paid' ? '  → follow up' : ''
    console.log(
      `${new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ')}  ` +
        `${row.status.padEnd(8)} ${formatCad(row.amount_cents).padStart(10)}  ` +
        `${row.email.padEnd(30)} ${row.titles ?? '(no items)'}${flag}${followUp}`,
    )
  }
}

async function main() {
  const product = arg('product')
  const publish = arg('publish')
  const unpublish = arg('unpublish')
  const giveTo = arg('give')
  const reissueTo = arg('reissue')

  const addServiceSlug = arg('add-service')

  if (has('list')) await listProducts()
  else if (has('payments')) await listPayments()
  else if (publish) await setPublished(publish, true)
  else if (unpublish) await setPublished(unpublish, false)
  else if (giveTo) {
    if (!product) return console.error('--give also needs --product <slug>')
    await give(giveTo, product, arg('name') ?? giveTo.split('@')[0])
  } else if (addServiceSlug) {
    const title = arg('title')
    const price = arg('price')
    if (!title || !price) {
      return console.error('--add-service also needs --title "…" and --price <CAD>')
    }
    await addService(addServiceSlug, title, Number(price), arg('summary') ?? '')
  } else if (reissueTo) await reissue(reissueTo)
  else {
    console.log(
      [
        'Usage:',
        '  pnpm grant --list',
        '  pnpm grant --payments',
        '  pnpm grant --publish <slug>',
        '  pnpm grant --unpublish <slug>',
        '  pnpm grant --give <email> --product <slug> [--name "Full Name"]',
        '  pnpm grant --reissue <email>',
        '  pnpm grant --add-service <slug> --title "…" --price <CAD> [--summary "…"]',
      ].join('\n'),
    )
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

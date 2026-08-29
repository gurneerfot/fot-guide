import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

/* ---------------------------------------------------------------- enums -- */

export const userStatusEnum = pgEnum('user_status', ['active', 'disabled'])

/**
 * What a purchase actually delivers.
 *
 * `reader` is material hosted here: the buyer gets an access code, an
 * entitlement and pages to read. `service` is delivered by a person — mock
 * tests and lesson plans — so it takes the money, mails a confirmation and
 * creates no account, because there is nothing on this site for them to open.
 */
export const productKindEnum = pgEnum('product_kind', ['reader', 'service'])
export const sessionEndedEnum = pgEnum('session_ended', ['signed_out', 'superseded'])

/**
 * `created` is written before the buyer ever reaches Razorpay, so an abandoned
 * checkout leaves a row that says so rather than leaving no trace at all.
 * `paid` is set only by the webhook — never by the browser.
 */
export const paymentStatusEnum = pgEnum('payment_status', [
  'created',
  'paid',
  'failed',
  'refunded',
])

/* ---------------------------------------------------------------- users -- */

/**
 * A buyer. Created by the Razorpay webhook, not by a signup form — there is no
 * public registration, because an account with no purchase behind it has
 * nothing to read.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Deterministic HMAC-SHA256 of the access code, hex. Exists only so a
     * single-field login can find the row in one indexed lookup — argon2 is
     * unsearchable by design. Never sufficient on its own to authenticate.
     */
    codeIndex: text('code_index').notNull(),
    codeHash: text('code_hash').notNull(),
    name: text('name').notNull(),
    /** How a repeat buyer is recognised, so they get access added rather than a second code. */
    email: text('email').notNull(),
    phone: text('phone'),
    status: userStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_code_index_uq').on(t.codeIndex),
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
  ],
)

/* ------------------------------------------------------------- sessions -- */

/**
 * One row per signed-in device. A code holds exactly one live session, so
 * signing in anywhere revokes everywhere else.
 *
 * This is the single most effective anti-sharing control in the product: a
 * buyer who passes their code around gets thrown out of their own material the
 * moment the other person opens it. No screenshot blocking comes close.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Throttled — written at most once a minute, not on every request. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Kept rather than deleted so the losing device can be told why. */
    endedBy: sessionEndedEnum('ended_by'),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_user_live_idx').on(t.userId, t.revokedAt),
  ],
)

/* ------------------------------------------------------------- products -- */

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    /** Shown on the storefront card. Plain text, not markup. */
    summary: text('summary').notNull().default(''),
    kind: productKindEnum('kind').notNull().default('reader'),
    /**
     * CAD cents, integer. All-in: exactly what the card is charged. Razorpay's
     * fee and the CAD→INR conversion spread come out of this, they are not
     * added on top, so the buyer never meets a number they did not agree to.
     */
    priceCents: integer('price_cents').notNull(),
    /** Struck through next to the price when set. Cosmetic only. */
    listPriceCents: integer('list_price_cents'),
    pageCount: integer('page_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('products_slug_uq').on(t.slug),
    check('products_price_positive', sql`${t.priceCents} > 0`),
    // A reader product with no pages is a book with nothing in it; a service
    // product has nothing to paginate. Publishing is gated on this in the CLI,
    // but the constraint is what makes it true.
    check(
      'products_reader_has_pages',
      sql`${t.kind} <> 'reader' or not ${t.isActive} or ${t.pageCount} > 0`,
    ),
  ],
)

/* --------------------------------------------------------------- pages -- */

/**
 * One rendered page of the material. The image itself is on disk outside
 * `public/`; this row is the index and the dimensions the reader needs to
 * reserve layout space before the image loads.
 */
export const materialPages = pgTable(
  'material_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    /** Relative to `content/pages/`. Never a URL — these are not publicly reachable. */
    imagePath: text('image_path').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
  },
  (t) => [
    uniqueIndex('material_pages_product_page_uq').on(t.productId, t.pageNumber),
    index('material_pages_product_idx').on(t.productId),
    check('material_pages_page_positive', sql`${t.pageNumber} >= 1`),
  ],
)

/* ------------------------------------------------------------ payments -- */

/**
 * One order. A buyer can put several things in the cart and pay for them
 * together, so what was bought lives in `payment_items` — this row is the money
 * and the person.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Null until the webhook provisions the buyer, and permanently null for a
     * `service` purchase, which creates no account. The payment is recorded
     * first and the account created second, so a failure in provisioning
     * leaves money that is traceable rather than money that vanished.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    razorpayOrderId: text('razorpay_order_id').notNull(),
    /** Null until capture. Unique when set — the idempotency key for the webhook. */
    razorpayPaymentId: text('razorpay_payment_id'),

    /** Captured at checkout, before an account exists. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),

    /**
     * The order total Razorpay charged, in CAD cents. Snapshotted rather than
     * summed from the items on read, so a later price change cannot rewrite
     * what someone actually paid.
     */
    amountCents: integer('amount_cents').notNull(),
    status: paymentStatusEnum('status').notNull().default('created'),

    /** Set when the access code has been issued. Null here after `paid` means work to redo. */
    provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payments_order_id_uq').on(t.razorpayOrderId),
    // Razorpay retries webhooks until it gets a 2xx. Without this, one payment
    // grants access twice and can mail out two different codes.
    uniqueIndex('payments_payment_id_uq').on(t.razorpayPaymentId),
    index('payments_email_idx').on(t.email),
    index('payments_status_idx').on(t.status),
  ],
)

/* ------------------------------------------------------ payment_items -- */

/**
 * A line on an order. One row per product bought, no quantity — these are
 * digital goods, and a second copy of the same mock test is not a thing anyone
 * needs.
 *
 * `restrict` on the product, so a product that has ever sold cannot be deleted
 * out from under its own sales record.
 */
export const paymentItems = pgTable(
  'payment_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    /** Snapshotted from the product at checkout. */
    unitPriceCents: integer('unit_price_cents').notNull(),
  },
  (t) => [
    // The cart is a set. Adding the same thing twice buys nothing extra, so it
    // must not be able to reach an order as two lines.
    uniqueIndex('payment_items_payment_product_uq').on(t.paymentId, t.productId),
    index('payment_items_payment_idx').on(t.paymentId),
    check('payment_items_price_positive', sql`${t.unitPriceCents} > 0`),
  ],
)

/* -------------------------------------------------------- entitlements -- */

/** What a buyer may read. The only thing the reader route consults. */
export const entitlements = pgTable(
  'entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Null for the manual grants that pay for themselves in goodwill. */
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('entitlements_user_product_uq').on(t.userId, t.productId),
    index('entitlements_user_idx').on(t.userId),
  ],
)

/* --------------------------------------------------------- page_views -- */

/**
 * Not analytics. A code being read from six cities in an hour is the signal
 * that it has been shared, and single-session eviction alone will not surface
 * that — the sharer just signs back in each time.
 */
export const pageViews = pgTable(
  'page_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    ip: text('ip'),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('page_views_user_time_idx').on(t.userId, t.viewedAt)],
)

/* ------------------------------------------------------ login_attempts -- */

/** Rate limiting. In-memory counters do not survive serverless. */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ip: text('ip').notNull(),
    succeeded: boolean('succeeded').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_ip_time_idx').on(t.ip, t.attemptedAt)],
)

/* ----------------------------------------------------------- relations -- */

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  entitlements: many(entitlements),
  payments: many(payments),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const productsRelations = relations(products, ({ many }) => ({
  pages: many(materialPages),
  entitlements: many(entitlements),
  paymentItems: many(paymentItems),
}))

export const materialPagesRelations = relations(materialPages, ({ one }) => ({
  product: one(products, { fields: [materialPages.productId], references: [products.id] }),
}))

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] }),
  items: many(paymentItems),
}))

export const paymentItemsRelations = relations(paymentItems, ({ one }) => ({
  payment: one(payments, { fields: [paymentItems.paymentId], references: [payments.id] }),
  product: one(products, { fields: [paymentItems.productId], references: [products.id] }),
}))

export const entitlementsRelations = relations(entitlements, ({ one }) => ({
  user: one(users, { fields: [entitlements.userId], references: [users.id] }),
  product: one(products, { fields: [entitlements.productId], references: [products.id] }),
  payment: one(payments, { fields: [entitlements.paymentId], references: [payments.id] }),
}))

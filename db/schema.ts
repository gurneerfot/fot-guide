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
  jsonb,
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
export const currencyEnum = pgEnum('currency', ['CAD', 'INR'])
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
    /**
     * Every code lasts 45 days. Reissuing a code resets this timestamp.
     */
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '45 days'`),
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
    /** CAD cents. All-in: exactly what the card is charged. */
    priceCents: integer('price_cents').notNull(),
    /** Struck through next to the price when set. Cosmetic only. */
    listPriceCents: integer('list_price_cents'),
    /** INR paise. Maintained separately so checkout never depends on a live FX rate. */
    priceInrPaise: integer('price_inr_paise').notNull(),
    /** Struck through next to the INR price when set. Cosmetic only. */
    listPriceInrPaise: integer('list_price_inr_paise'),
    pageCount: integer('page_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('products_slug_uq').on(t.slug),
    check('products_price_positive', sql`${t.priceCents} > 0`),
    check('products_inr_price_positive', sql`${t.priceInrPaise} > 0`),
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

    /** Identifies whether `amount_cents` contains CAD cents or INR paise. */
    currency: currencyEnum('currency').notNull().default('CAD'),
    /**
     * The order total Razorpay charged, in the currency's minor unit.
     * Snapshotted so a later price change cannot rewrite what was paid.
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
    /** Snapshotted in the parent payment's currency-specific minor unit. */
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

/* ----------------------------------------------------------- demo_slots -- */

/**
 * A 30-minute free demo class the owner has opened for booking.
 *
 * Deliberately unconnected to anything above: a demo booker is not a buyer,
 * gets no account and no code, and nothing here can reach a reader's access.
 *
 * `starts_at` is an instant (UTC underneath). Every wall-clock rendering —
 * India for the owner, Europe or anywhere for the booker — happens at the
 * edge, from the viewer's own time zone.
 */
export const demoSlots = pgTable(
  'demo_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** How many people may book this call. Set per slot by the owner. */
    capacity: integer('capacity').notNull().default(2),
    /**
     * One call per slot, shared by every seat. Null until the first booking:
     * planning a slot touches nothing in Google, and the call is started by
     * whoever books first.
     */
    meetUrl: text('meet_url'),
    /**
     * The call's Google conference data, copied onto every later booking's
     * event so they all land in the same Meet. Null until the first booking.
     */
    meetConference: jsonb('meet_conference'),
    /**
     * Only on slots planned before bookings had their own events: the one
     * slot-wide calendar event that holds the call. Never set on new slots.
     */
    googleEventId: text('google_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('demo_slots_starts_at_uq').on(t.startsAt),
    check('demo_slots_capacity_range', sql`${t.capacity} between 1 and 50`),
  ],
)

/* -------------------------------------------------------- demo_bookings -- */

/**
 * One seat taken in a demo slot. A slot holds `capacity` of them.
 *
 * The seat number is what makes overbooking impossible rather than merely
 * unlikely: `(slot_id, seat)` is unique, and a trigger in migration 0008
 * (`demo_bookings_seat_within_capacity`) refuses any seat above the slot's
 * capacity — so a sixth row in a five-seat slot cannot exist no matter how the
 * requests race. The booking transaction locks the slot first, so in practice
 * neither is the thing that says no; they are there for when that code is wrong.
 *
 * `restrict` on the slot, so a slot with someone booked into it cannot be
 * deleted out from under them.
 */
export const demoBookings = pgTable(
  'demo_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => demoSlots.id, { onDelete: 'restrict' }),
    seat: integer('seat').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    /** In the booker's words: where their French is today. */
    levelNote: text('level_note').notNull(),
    /** IANA zone the booker saw the slot in, so their email says the same time. */
    timeZone: text('time_zone').notNull(),
    /** Throttling only — how many bookings one address makes in a day. */
    ip: text('ip'),
    /** This booking's own event on the owner's calendar, with the booker as guest. */
    googleEventId: text('google_event_id'),
    /**
     * Resend id of the "starts in an hour" email, scheduled ahead. Null until
     * scheduled — Resend takes at most 30 days ahead, so a far-off booking is
     * scheduled later by the daily job. Kept so removing a booking cancels it.
     */
    reminderEmailId: text('reminder_email_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('demo_bookings_slot_seat_uq').on(t.slotId, t.seat),
    // One person cannot take both seats of the same call.
    uniqueIndex('demo_bookings_slot_email_uq').on(t.slotId, sql`lower(${t.email})`),
    index('demo_bookings_ip_time_idx').on(t.ip, t.createdAt),
    check('demo_bookings_seat_positive', sql`${t.seat} >= 1`),
  ],
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

export const demoSlotsRelations = relations(demoSlots, ({ many }) => ({
  bookings: many(demoBookings),
}))

export const demoBookingsRelations = relations(demoBookings, ({ one }) => ({
  slot: one(demoSlots, { fields: [demoBookings.slotId], references: [demoSlots.id] }),
}))

# Français on Tips — study material

A standalone storefront for three things: a study guide you read here, TEF mock
tests, and a ten-lesson plan. Someone puts what they want in a cart, pays once
with Razorpay, and is looked after according to what was in it — an access code
by email for the guide, which gives them 45 days to read it page by page in the
browser with nothing downloadable; a confirmation and a call from a person for
the rest. A single order can hold both.

Deliberately independent of the mock-test platform (`../Mocks-FOT`): its own
database, its own accounts, its own deploy. They share a visual language and the
same access-code login design, nothing else.

```
                                       ┌─ reader items  -> account + access code -> login -> reader
cart -> Razorpay -> webhook -> order ──┤
                                       └─ service items -> WhatsApp link, no account
```

Every product carries a `kind`. `reader` is material hosted here. `service` is
delivered by a person — it takes the money, confirms it, and grants nothing,
because there is nothing on this site for that buyer to open.

An order is a basket: `payments` is the money and the person, `payment_items` is
what was bought. A basket holding both kinds issues one access code covering the
reader items and flags the services for follow-up, in **one** email.

## Stack

- Next.js 16 (App Router, TypeScript), deployed to Vercel
- Postgres (Neon) + Drizzle ORM
- Tailwind CSS v4
- `jose` for JWT session cookies, argon2 for hashing the access code
- `sharp` for watermarking page images per request
- Zod on every request body
- Razorpay over plain `fetch` — no SDK, charged in CAD or INR

## Setup

```bash
pnpm install
cp .env.example .env.local     # then fill it in
pnpm db:push                   # create the tables
```

Generate the two secrets with `openssl rand -base64 48`. `LOGIN_CODE_PEPPER`
must be set once and never rotated — changing it invalidates every stored code
index, and every buyer would need a reissued code.

### Local database

The `.env.local` in this repo points at a throwaway Postgres in Docker:

```bash
docker run -d --rm --name fot-study-pg \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=fot_study_dev \
  -p 55432:5432 postgres:17-alpine
pnpm db:push
```

`db/index.ts` detects a localhost connection string and uses the direct
`node-postgres` driver; anything else goes through Neon's serverless driver.
Production always takes the second path.

## Prices

Everything has fixed **CAD and INR** prices, stored as integer cents or paise,
and is **all-in**: the number on the card is exactly what Razorpay charges.
Nothing is added at the payment step.

| Product | CAD price | INR price |
| ------- | --------- | --------- |
| Study guide | CA$28 | ₹1,899 |
| Mock test, per module | CA$28 | ₹1,899 |
| 10-lesson plan | CA$280 | ₹17,999 |

Gateway costs come out of that, never added for the buyer:

- **CAD: ~5.54%** — the 3% international card fee, 18% GST on that fee, and an
  estimated 2% CAD→INR settlement spread
- **INR: ~2.36%** — the 2% domestic gateway fee plus 18% GST on that fee

`lib/money.ts` holds currency-specific fee estimates so `pnpm grant --list`
can show what a sale is worth. They are **not** used at checkout — both prices
are set deliberately, not converted live — and Razorpay's dashboard remains
the authority on what was actually deducted.

No sales tax is charged or collected, matching a business not registered in
Canada. To reprice, change the number and re-run the command that created the
product; nothing is derived from it.

## Adding study material

Requires poppler (`pdftoppm`) locally — `sudo pacman -S poppler`. It is only
needed at ingest time, never at runtime.

```bash
pnpm ingest --pdf ./material.pdf \
            --slug guide-expression-orale-b \
            --title "Guide — Expression Orale, Section B" \
            --price 28 \
            --price-inr 1899 \
            --summary "Common TEF Canada arguments with suitable responses."
```

`--price` is in Canadian dollars and `--price-inr` is in Indian rupees. Both
are all-in.

Each page is rendered at 150dpi, resized to 1400px wide and stored as JPEG in
`content/pages/<slug>/`. The rendered pages are committed so Vercel can bundle
them, which means this repository must remain private. The DB stores only the
relative path.

The product is created **inactive**. Look at the pages, then publish:

```bash
pnpm grant --publish guide-expression-orale-b
```

Re-running `pnpm ingest` with the same slug replaces every page and updates the
price, title and page count.

## Adding a mock test or a lesson plan

These have no pages, so `pnpm ingest` cannot make them:

```bash
pnpm grant --add-service mock-writing \
           --title "TEF Canada Mock — Writing" \
           --price 28 \
           --price-inr 1899 \
           --summary "A full-length Expression écrite mock, marked and returned."
```

Created inactive, same as a book. Publish with `pnpm grant --publish <slug>`.
Re-running with the same slug updates the title, both prices and summary; a flag
left off leaves that field as it was.

Six already exist: the four TEF mock modules `mock-reading`, `mock-listening`,
`mock-writing`, `mock-speaking` (CA$28 each), `mocks-all-four` (CA$110), and
`lessons-10` (CA$250 — ten lessons at CA$25 each).

### Selling several together

A bundle is an ordinary service product with its own price — there is no
multi-item discount rule, because a rule that fires on the contents of a cart is
one more thing to get wrong for money. `--list-price` sets the figure struck
through beside it, so the saving is visible on the card rather than asserted in
the summary:

```bash
pnpm grant --add-service mocks-all-four \
           --title "TEF Canada Mocks — All Four Modules" \
           --price 110 --price-inr 7499 \
           --list-price 112 --list-price-inr 7596 \
           --summary "All four mocks together, each marked and returned."
```

Nothing stops a buyer adding the bundle *and* a single mock; both lines simply
appear in the order. Keep the bundle's title saying what it contains.

When one of these sells, the buyer's confirmation email carries a WhatsApp
link — `wa.me` with the purchase already written into the message — and the same
link appears on the success screen.

The buyer opens the conversation, deliberately. Nothing is emailed to the seller
and nothing has to be noticed: an unread alert cannot strand someone who has
paid. `pnpm grant --payments` still lists service orders with `→ follow up` so a
quiet buyer can be found.

The number lives in `lib/contact.ts`. Changing it there changes it everywhere.

## Owner CLI

```bash
pnpm grant --list                  # products, live or draft, with the estimated net
pnpm grant --payments              # last 50 orders with their line items; flags what needs acting on
pnpm grant --publish <slug>
pnpm grant --unpublish <slug>
pnpm grant --give <email> --product <slug> --name "Full Name"
pnpm grant --reissue <email>       # lost code, or cutting off a shared one
pnpm grant --add-service <slug> --title "…" --price <CAD> --price-inr <INR> [--summary "…"] \
                                [--list-price <CAD> --list-price-inr <INR>]   # struck-through "was" price
```

`--give` works only on `reader` products. Granting an entitlement to a service
would put a dead link in someone's library — those are arranged directly.

`--reissue` invalidates the previous code immediately.

## Razorpay

1. **API keys** — Dashboard → Settings → API Keys. Use `rzp_test_*` until you
   are ready to take real money.
2. **International Payments** — Dashboard → Settings → Configuration. CAD
   orders require this; INR orders use Razorpay's domestic path. Without it,
   Razorpay rejects CAD orders with a currency error and does not fall back to
   INR.
3. **Webhook** — Dashboard → Settings → Webhooks. Point it at
   `https://<your-domain>/api/webhooks/razorpay`, subscribe to
   **`payment.captured`**, and put its secret in `RAZORPAY_WEBHOOK_SECRET`.

The webhook is not optional. It is the path that works when the buyer closes the
tab on the payment screen or loses signal — exactly the cases that otherwise
become "I paid and got nothing". The browser confirm call
(`/api/checkout/confirm`) exists only so the code appears on screen immediately;
both routes run the same idempotent settlement, so either one alone is enough.

Razorpay will not activate a live account until Terms, Privacy, Refund and
Contact pages are reachable. They exist at `/terms`, `/privacy`, `/refunds` and
`/contact` — **as drafts**. Everything in `SQUARE BRACKETS` in
`app/_components/legal-copy.tsx` is a placeholder for real business details, and
the policies need reading by someone who knows your obligations.

## What the copy protection actually does

Screenshots cannot be blocked in a browser. There is no web API for it; the OS
screenshot tool and a phone camera both sit below anything a web page can reach.
`FLAG_SECURE` works only in a native Android app, and Widevine covers video
streams, not HTML. Any product claiming otherwise is detecting a PrintScreen
keypress, which takes seconds to bypass.

So this is built for **attribution and deterrence**, not prevention:

- **Per-buyer watermark, composited server-side.** Every page carries the
  buyer's name and email diagonally across it plus an attribution strip along
  the bottom. Done in `sharp` rather than as a CSS overlay, because a CSS
  overlay leaves the underlying image clean and one request away in devtools.
- **One live session per code.** Signing in anywhere revokes every other device.
  Sharing a code throws the sharer out of their own material, and the evicted
  device is told why rather than being silently bounced. This is the strongest
  control here.
- **No file to take.** Pages are served as individual images through an
  authenticated route, never as a PDF, and never from `public/`.
- **Casual friction.** Right-click, Ctrl+P, Ctrl+S, drag-to-desktop and
  long-press-to-save are all suppressed, and printing yields a licence notice
  instead of the material. None of this stops a determined copy; it stops the
  thoughtless one.
- **Sharing signals.** `page_views` records who read which page from which IP,
  so a code being read from six cities in an hour is visible after the fact.

## Demo class booking

`/demo` lists free 30-minute demo classes in the visitor's own time zone. Each
slot has two seats; both bookers join the same Google Meet. The owner adds and
removes slots and sees who booked at `/admin`.

It shares nothing with the shop but the database: two tables of its own
(`demo_slots`, `demo_bookings`), its own login (`fot_study_admin` cookie,
`ADMIN_*` variables), and no link to `users`, sessions or entitlements.
Nothing in it can reach a buyer's access.

- **Times** are stored as instants and formatted in the viewer's browser (the
  server runs in UTC). Emails use the booker's zone, recorded at booking, and
  `ADMIN_TIME_ZONE` for the owner. Both carry an `.ics` invite.
- **Overbooking** is impossible, not just unlikely: booking locks the slot row,
  and `(slot_id, seat)` is unique with `seat` limited to 1–2.
- **One upcoming demo per email**, five bookings per IP a day, and optional
  Turnstile.
- **The Meet link is made when the owner adds a slot**, not at booking, so a
  Google failure shows up to the owner at the moment they can retry, never to a
  visitor.

### Switching it on

1. **Back up first.** Neon → Branches → create a branch of production.
2. Apply the migration, and only it:

   ```bash
   pnpm db:migrate        # applies 0008_demo_booking: CREATE TABLE ×2, nothing else
   ```

   Production's history already holds 0000–0007 with matching hashes, so this
   runs the new file alone. Never `db:push` against production.
3. `pnpm admin:password`, `openssl rand -base64 48` → set `ADMIN_PASSWORD_HASH`,
   `ADMIN_SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_TIME_ZONE` in Vercel.
4. Google (optional, see below) or paste a Meet link per slot.
5. Deploy, sign in at `/admin`, add a slot, book it yourself at `/demo`.
6. Set `NEXT_PUBLIC_DEMO_BOOKING=on` and redeploy to move the header button
   off Calendly.

### Google Meet links on a personal account

1. console.cloud.google.com → new project → enable **Google Calendar API**.
2. OAuth consent screen → External → add the `calendar.events` scope → then
   **Publish app** ("In production"). Left in Testing, the refresh token dies
   after 7 days. Google will show an "unverified app" warning when you sign in;
   that is expected, since only the owner ever signs in.
3. Credentials → OAuth client ID → **Desktop app**. Put the id and secret in
   `.env.local`.
4. `pnpm google:auth`, sign in as the account that will host the calls, copy
   `GOOGLE_REFRESH_TOKEN` into Vercel.

Bookers are not added as guests, so Meet shows them a waiting screen and the
host admits them — the host must be signed in as that account. If slot creation
ever says Google sign-in expired, run `pnpm google:auth` again.

## Verifying

```bash
pnpm check       # purchase -> access flow, against DATABASE_URL
```

**This deletes every row in the target database**, so it refuses to run unless
`DATABASE_URL` is local — `.env.local` points at production. Use
`DATABASE_URL=postgresql://postgres:dev@localhost:55432/fot_study_dev pnpm check`.
`pnpm check:demo` covers demo booking the same way (five people racing for two
seats, the seat constraint, time zones) and touches only the demo tables.
It covers the cases that quietly cost money: an unpaid order being provisioned,
a retried webhook issuing a second code, three concurrent settlements racing, a
repeat buyer getting a duplicate account, a reused Razorpay payment id, a
service purchase creating an account it should not, a retried webhook sending a
second confirmation, a mixed basket entitling someone to a mock test they can
never open, and the same product reaching one order twice.

```bash
pnpm typecheck && pnpm lint && pnpm build
```

## Known limits

- **Page images ship with the deployment.** `next.config.ts` traces
  `content/pages/**` into the function bundle. Fine for one book of a few
  hundred pages; past that, or if you want to update material without
  redeploying, move them to blob storage and swap the `readFile` in
  `lib/content.ts`.
- **Watermarking costs ~320ms per page** on a warm instance, ~450ms for the
  first page a given buyer opens. The overlay is cached per buyer per page size,
  so it is built once per book rather than once per page. Browsers cache the
  result privately for 10 minutes.
- **Email is best-effort.** If Resend is not configured, or a send fails, the
  purchase still completes and the code still appears on the success screen. A
  failure is logged, never surfaced to the buyer mid-payment.

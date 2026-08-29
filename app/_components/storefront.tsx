'use client'

import Link from 'next/link'
import Script from 'next/script'
import { useMemo, useRef, useState } from 'react'
import { purchaseMessage, whatsappUrl } from '@/lib/contact'
import { formatCad } from '@/lib/money'
import { IconBag, IconBook, IconCheck, IconClose, IconLock, IconTeam, IconWhatsApp } from './icons'

/** Razorpay's Checkout attaches this to `window` once its script has loaded. */
type RazorpayOptions = {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  prefill: { name: string; email: string; contact: string }
  theme: { color: string }
  handler: (response: RazorpayHandlerResponse) => void
  modal: { ondismiss: () => void }
}
type RazorpayHandlerResponse = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}
type RazorpayInstance = { open: () => void }
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

export type StorefrontProduct = {
  id: string
  slug: string
  title: string
  summary: string
  kind: 'reader' | 'service'
  priceCents: number
  listPriceCents: number | null
  pageCount: number
}

type Phase =
  | { step: 'browsing' }
  | { step: 'working' }
  /** Settled by this call. `code` is present only for a brand-new account. */
  | {
      step: 'done'
      email: string
      code: string | null
      readerTitles: string[]
      serviceTitles: string[]
    }
  /** The webhook settled first, so whatever was owed is only in the inbox. */
  | { step: 'check-email'; email: string }

export function Storefront({ products }: { products: StorefrontProduct[] }) {
  const [cart, setCart] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase>({ step: 'browsing' })
  const [scriptReady, setScriptReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cartRef = useRef<HTMLElement>(null)

  const inCart = useMemo(() => new Set(cart), [cart])
  const lines = useMemo(
    () =>
      cart
        .map((slug) => products.find((p) => p.slug === slug))
        .filter(Boolean) as StorefrontProduct[],
    [cart, products],
  )
  const total = lines.reduce((sum, line) => sum + line.priceCents, 0)

  function toggle(slug: string) {
    setError(null)
    setCart((current) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    )
  }

  async function checkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') ?? '').trim()
    const email = String(data.get('email') ?? '').trim()
    const phone = String(data.get('phone') ?? '').trim()

    if (!window.Razorpay) {
      setError('Payment window is still loading. Give it a moment and try again.')
      return
    }

    setPhase({ step: 'working' })
    let order: {
      orderId: string
      amountCents: number
      keyId: string
      description: string
      prefill: { name: string; email: string; contact: string }
    }
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slugs: cart, name, email, phone }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Could not start the payment.')
      order = payload
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the payment.')
      setPhase({ step: 'browsing' })
      return
    }

    const razorpay = new window.Razorpay({
      key: order.keyId,
      amount: order.amountCents,
      currency: 'CAD',
      name: 'Français on Tips',
      description: order.description,
      order_id: order.orderId,
      prefill: order.prefill,
      theme: { color: '#10244a' },
      handler: async (response) => {
        try {
          const confirmed = await fetch('/api/checkout/confirm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(response),
          })
          const payload = await confirmed.json()

          if (payload.status === 'settled') {
            setCart([])
            setPhase({
              step: 'done',
              email: payload.email,
              code: payload.code ?? null,
              readerTitles: payload.readerTitles ?? [],
              serviceTitles: payload.serviceTitles ?? [],
            })
          } else if (payload.status === 'already-settled') {
            setCart([])
            setPhase({ step: 'check-email', email: payload.email })
          } else {
            // Paid, but settlement is still catching up. The webhook finishes
            // the job regardless, so this is a wait, not a failure.
            setError(payload.error ?? 'Payment received. Your confirmation is on its way by email.')
            setPhase({ step: 'browsing' })
          }
        } catch {
          setError('Payment received. Your confirmation is on its way by email.')
          setPhase({ step: 'browsing' })
        }
      },
      // Closing the modal is a cancel, not an error — say nothing, keep the
      // cart intact and let them try again.
      modal: { ondismiss: () => setPhase({ step: 'browsing' }) },
    })
    razorpay.open()
  }

  if (phase.step === 'done' || phase.step === 'check-email') {
    return <OrderComplete phase={phase} />
  }

  const busy = phase.step === 'working'

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        onReady={() => setScriptReady(true)}
        onError={() => setError('Could not reach the payment provider.')}
      />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-10">
        <section aria-label="Available material" className="space-y-6">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              selected={inCart.has(product.slug)}
              disabled={busy}
              onToggle={() => toggle(product.slug)}
            />
          ))}
        </section>

        <Cart
          ref={cartRef}
          lines={lines}
          total={total}
          busy={busy}
          scriptReady={scriptReady}
          error={error}
          onRemove={toggle}
          onSubmit={checkout}
        />
      </div>

      {lines.length > 0 && (
        <MobileBar
          count={lines.length}
          total={total}
          onReview={() => cartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ card -- */

function ProductCard({
  product,
  selected,
  disabled,
  onToggle,
}: {
  product: StorefrontProduct
  selected: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const isReader = product.kind === 'reader'
  const Badge = isReader ? IconBook : IconTeam

  return (
    <article
      className={`group rounded-card border bg-card p-6 transition-[box-shadow,border-color] duration-200 sm:p-8 ${
        selected
          ? 'border-ink shadow-card-hover'
          : 'border-rule shadow-card hover:border-ink/25 hover:shadow-card-hover'
      }`}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rouge-wash px-3 py-1.5 text-xs font-semibold text-rouge">
        <Badge className="size-3.5" />
        {isReader ? 'Read online' : 'With our team'}
      </span>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h2 className="min-w-0 flex-1 font-display text-xl leading-snug font-bold text-ink sm:text-2xl">
          {product.title}
        </h2>
        <div className="shrink-0 text-right">
          <span className="font-display text-xl font-bold text-rouge sm:text-2xl">
            {formatCad(product.priceCents)}
          </span>
          {product.listPriceCents != null && product.listPriceCents > product.priceCents && (
            <span className="ml-2 text-sm text-ink-soft line-through">
              {formatCad(product.listPriceCents)}
            </span>
          )}
        </div>
      </div>

      {product.summary && (
        <p className="mt-3 max-w-prose text-read whitespace-pre-line text-ink-soft">
          {product.summary}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-rule pt-5">
        <p className="flex items-center gap-2.5 text-sm text-ink-soft">
          <Badge className="size-4 shrink-0 text-rouge" />
          {isReader
            ? `Instant access${product.pageCount > 0 ? ` · ${product.pageCount} pages` : ''}`
            : 'Arrange on WhatsApp after purchase'}
        </p>

        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={selected}
          className={`inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors duration-200 disabled:opacity-50 ${
            selected
              ? 'border-ink bg-ink text-white hover:bg-ink-deep'
              : 'border-ink/25 bg-card text-ink hover:border-ink hover:bg-ink/[0.03]'
          }`}
        >
          {selected && <IconCheck className="size-4" />}
          {selected ? 'Added' : 'Add to order'}
        </button>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ cart -- */

function Cart({
  ref,
  lines,
  total,
  busy,
  scriptReady,
  error,
  onRemove,
  onSubmit,
}: {
  ref: React.Ref<HTMLElement>
  lines: StorefrontProduct[]
  total: number
  busy: boolean
  scriptReady: boolean
  error: string | null
  onRemove: (slug: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const empty = lines.length === 0

  return (
    <aside
      ref={ref}
      aria-label="Your order"
      className="scroll-mt-24 rounded-card border border-rule bg-card p-6 shadow-card sm:p-7 lg:sticky lg:top-24"
    >
      <h2 className="font-display text-lg font-bold text-ink">Your order</h2>

      {empty ? (
        <EmptyOrder />
      ) : (
        <>
          <ul className="mt-5 space-y-4">
            {lines.map((line) => (
              <li key={line.slug} className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug font-semibold text-ink">{line.title}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {line.kind === 'reader' ? 'Read online' : 'With our team'}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold whitespace-nowrap text-ink">
                  {formatCad(line.priceCents)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(line.slug)}
                  disabled={busy}
                  aria-label={`Remove ${line.title}`}
                  className="-mt-0.5 shrink-0 rounded p-1 text-ink-soft transition-colors duration-200 hover:bg-rouge-wash hover:text-rouge disabled:opacity-50"
                >
                  <IconClose className="size-4" />
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-baseline justify-between border-t border-rule pt-5">
            <span className="font-semibold text-ink">Total</span>
            <span className="font-display text-2xl font-bold text-rouge">{formatCad(total)}</span>
          </div>
          <p className="mt-1.5 text-xs text-ink-soft">
            All taxes and charges included. Nothing is added at the payment step.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <Field
              name="name"
              label="Full name"
              autoComplete="name"
              maxLength={80}
              disabled={busy}
              required
            />
            <Field
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
              maxLength={160}
              disabled={busy}
              required
              hint="Your confirmation and access code go here."
            />
            <Field
              name="phone"
              label="WhatsApp / Phone"
              type="tel"
              autoComplete="tel"
              maxLength={20}
              disabled={busy}
              required
              hint="How our team reaches you about mocks and lessons."
            />

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-rouge/30 bg-rouge-wash px-3.5 py-3 text-sm text-rouge"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !scriptReady}
              className="w-full rounded-lg bg-ink px-5 py-3.5 font-semibold text-white transition-colors duration-200 hover:bg-ink-deep disabled:opacity-50"
            >
              {busy ? 'Opening payment…' : `Pay ${formatCad(total)}`}
            </button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-ink-soft">
              <IconLock className="size-3.5" />
              Secure payment by Razorpay · in Canadian dollars
            </p>
          </form>
        </>
      )}
    </aside>
  )
}

/**
 * An empty panel is the first thing most visitors see, so it gets a real
 * treatment rather than one grey sentence — it has to read as "nothing chosen
 * yet", never as "this component failed to load".
 */
function EmptyOrder() {
  return (
    <div className="py-8 text-center">
      <div className="relative mx-auto size-20">
        <div className="absolute inset-0 rounded-full bg-paper" />
        <IconBag className="absolute inset-0 m-auto size-9 text-ink" />
        {/* Small brand-coloured marks, so the space reads as considered. */}
        <span aria-hidden className="absolute top-1 right-0 size-1.5 rounded-full bg-rouge" />
        <span aria-hidden className="absolute bottom-2 left-0 size-1 rounded-full bg-ink/30" />
        <span aria-hidden className="absolute top-3 left-1 size-1 rounded-full bg-rouge/40" />
      </div>
      <p className="mt-5 font-semibold text-ink">Nothing selected yet.</p>
      <p className="mx-auto mt-1.5 max-w-[16rem] text-sm leading-relaxed text-ink-soft">
        Add anything above — you can buy several together and pay once.
      </p>
    </div>
  )
}

function Field({
  name,
  label,
  hint,
  ...input
}: {
  name: string
  label: string
  hint?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <input
        name={name}
        {...input}
        className="mt-1.5 w-full rounded-lg border border-rule bg-card px-3.5 py-2.5 text-read text-ink transition-colors duration-200 placeholder:text-ink-soft hover:border-ink/30 disabled:opacity-60"
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-soft">{hint}</span>}
    </label>
  )
}

/* ------------------------------------------------------------ mobile bar -- */

/**
 * The cart sits below the products on a narrow screen, so without this a buyer
 * who has selected something has no idea it is there until they scroll.
 */
function MobileBar({
  count,
  total,
  onReview,
}: {
  count: number
  total: number
  onReview: () => void
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-5 mt-8 border-t border-rule bg-card/95 px-5 py-3.5 backdrop-blur-md sm:-mx-8 sm:px-8 lg:hidden">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-ink-soft">
            {count} item{count === 1 ? '' : 's'}
          </p>
          <p className="font-display text-lg font-bold text-rouge">{formatCad(total)}</p>
        </div>
        <button
          type="button"
          onClick={onReview}
          className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-ink-deep"
        >
          Review order
        </button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- complete -- */

function OrderComplete({
  phase,
}: {
  phase: Extract<Phase, { step: 'done' } | { step: 'check-email' }>
}) {
  if (phase.step === 'check-email') {
    return (
      <div className="mx-auto max-w-2xl rounded-card border border-rule bg-card p-8 text-center shadow-card sm:p-10">
        <SuccessMark />
        <h2 className="mt-5 font-display text-2xl font-bold text-ink">Payment received.</h2>
        <p className="mx-auto mt-3 max-w-md text-read text-ink-soft">
          Your confirmation has already been sent to {phase.email}. Please open it
          for your next step — if it carries an access code, that is the only
          copy, so keep it safe.
        </p>
        <Link
          href="/login"
          className="mt-7 inline-block rounded-lg bg-ink px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-ink-deep"
        >
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl rounded-card border border-rule bg-card p-8 shadow-card sm:p-10">
      <div className="text-center">
        <SuccessMark />
        <h2 className="mt-5 font-display text-2xl font-bold text-ink">
          Payment received. Thank you.
        </h2>
        <p className="mt-3 text-read text-ink-soft">
          A confirmation is on its way to {phase.email}.
        </p>
      </div>

      {phase.readerTitles.length > 0 && (
        <section className="mt-8 border-t border-rule pt-7">
          <h3 className="flex items-center gap-2 font-semibold text-ink">
            <IconBook className="size-4 text-rouge" />
            To read online
          </h3>
          <ul className="mt-2 list-disc pl-5 text-read text-ink-soft">
            {phase.readerTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>

          {phase.code ? (
            <>
              <p className="mt-5 text-sm text-ink-soft">
                Write this code down now — for your security it is stored
                encrypted and cannot be shown again.
              </p>
              {/* Sized down on the narrowest phones: the code plus its
                  letter-spacing is the widest unbreakable string on the page. */}
              <p className="my-4 rounded-lg border border-rule bg-paper px-4 py-5 text-center font-mono text-xl font-bold tracking-[0.12em] text-ink sm:text-2xl sm:tracking-[0.15em]">
                {phase.code}
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-ink-soft">
              This has been added to your existing account — sign in with the
              access code you already have.
            </p>
          )}

          <Link
            href="/login"
            className="mt-2 inline-block rounded-lg bg-ink px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-ink-deep"
          >
            Sign in and start reading
          </Link>
        </section>
      )}

      {phase.serviceTitles.length > 0 && (
        <section className="mt-8 border-t border-rule pt-7">
          <h3 className="flex items-center gap-2 font-semibold text-ink">
            <IconTeam className="size-4 text-rouge" />
            Next step
          </h3>
          <ul className="mt-2 list-disc pl-5 text-read text-ink-soft">
            {phase.serviceTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
          <p className="mt-4 text-read text-ink-soft">
            Message us on WhatsApp to arrange it — the chat opens with your
            purchase already written out.
          </p>
          <a
            href={whatsappUrl(purchaseMessage(phase.serviceTitles))}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-6 py-3 font-semibold text-white transition-opacity duration-200 hover:opacity-90"
          >
            <IconWhatsApp className="size-5" />
            Message us on WhatsApp
          </a>
          <p className="mt-3 text-sm text-ink-soft">
            There is no access code for these — they are not something you open here.
          </p>
        </section>
      )}
    </div>
  )
}

function SuccessMark() {
  return (
    <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-rouge-wash">
      <IconCheck className="size-7 text-rouge" />
    </span>
  )
}

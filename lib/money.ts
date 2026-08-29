/** Money is always stored and sent as integer minor units: CAD cents or INR paise. */
export const CURRENCIES = ['CAD', 'INR'] as const
export type Currency = (typeof CURRENCIES)[number]

export type DualPrice = {
  priceCents: number
  priceInrPaise: number
  listPriceCents?: number | null
  listPriceInrPaise?: number | null
}

/**
 * Prices are all-in: the number on the card is exactly what Razorpay charges.
 * The costs below come out of it rather than being added on top, so a buyer
 * never meets a total they did not agree to on the way in.
 *
 * Verified against razorpay.com/pricing, August 2026:
 *   3.54%  international card — 3% platform fee plus 18% GST on that fee
 *   ~2.0%  CAD→INR conversion spread, inside the exchange rate on settlement
 *
 * Deliberately not used at checkout. It exists so the owner CLI can show what a
 * sale is actually worth, and it is an estimate — Razorpay's own dashboard is
 * the authority on what was deducted.
 */
const ESTIMATED_COST_BPS: Record<Currency, number> = {
  CAD: 554,
  // 2% domestic gateway fee plus 18% GST on that fee.
  INR: 236,
}

export function priceFor(product: DualPrice, currency: Currency): number {
  return currency === 'CAD' ? product.priceCents : product.priceInrPaise
}

export function listPriceFor(product: DualPrice, currency: Currency): number | null {
  return currency === 'CAD'
    ? (product.listPriceCents ?? null)
    : (product.listPriceInrPaise ?? null)
}

/** Minor units to a display string: CAD 2800 -> CA$28.00; INR 189900 -> ₹1,899. */
export function formatMoney(minor: number, currency: Currency): string {
  if (currency === 'INR') {
    return `₹${(minor / 100).toLocaleString('en-IN', {
      minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })}`
  }
  return `CA$${(minor / 100).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Roughly what lands after the gateway and the currency conversion.
 *
 * Rounded down, so the figure is never optimistic — a seller reading this
 * should be pleasantly surprised, not short.
 */
export function estimatedNetMinor(chargedMinor: number, currency: Currency): number {
  return Math.floor(chargedMinor * (1 - ESTIMATED_COST_BPS[currency] / 10_000))
}

/**
 * Money. Everything is CAD, stored as integer cents.
 *
 * Floats are not allowed near a price: 0.1 + 0.2 is 0.30000000000000004, and
 * that eventually charges someone CA$28.000000001. Razorpay's API speaks minor
 * units anyway, so cents is both the safe representation and the wire format.
 */

/** Razorpay is told this explicitly on every order — never left to default. */
export const CURRENCY = 'CAD'

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
export const ESTIMATED_COST_BPS = 554

/** Cents to a display string: 2800 -> "CA$28.00". */
export function formatCad(cents: number): string {
  return `CA$${(cents / 100).toLocaleString('en-CA', {
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
export function estimatedNetCents(chargedCents: number): number {
  return Math.floor(chargedCents * (1 - ESTIMATED_COST_BPS / 10_000))
}

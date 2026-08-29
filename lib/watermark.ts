import sharp from 'sharp'

/**
 * Burns the buyer's identity into a page image before it is sent.
 *
 * Screenshots cannot be prevented in a browser — no web API exists, and the OS
 * screenshot tool and a phone camera both sit below anything a page can reach.
 * So the goal is not prevention but attribution: every copy in circulation
 * names the account it came from. Compositing server-side rather than
 * overlaying in CSS matters, because a CSS overlay leaves the underlying image
 * clean and one request away for anyone who opens devtools.
 */

export type Viewer = {
  name: string
  email: string
}

/** SVG is XML. A buyer named `Ben & Co <ben@…>` would otherwise throw here. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Keeps a long name from running the footer off the edge of a narrow page. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

const FONT_STACK = 'DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif'
const TILE_FONT = 23
const TILE_ANGLE = 30
/** Blank margin around each repeat, so neighbouring lines do not touch. */
const TILE_GAP = 70

/**
 * Whole-page overlays, kept between requests.
 *
 * The rasterising is the expensive half of this job — around 700ms for a page,
 * against roughly 250ms to decode the page and encode the result. But an
 * overlay depends only on the buyer and the page dimensions, and every page of
 * a book has the same dimensions, so it is the same image every time. Building
 * it once per buyer per book turns every page after the first into a plain
 * composite.
 *
 * Bounded because a warm serverless instance serves many buyers; without a cap
 * this would grow with every distinct reader the instance ever sees. Overlays
 * are mostly transparent and compress hard, so the ceiling is a few MB.
 */
const MAX_CACHED = 24
const overlayCache = new Map<string, Buffer>()

/**
 * The diagonal repeat of the buyer's name, plus the attribution strip along the
 * bottom edge, as one transparent PNG the size of the page.
 *
 * Opacity on the diagonal text is deliberately low: high enough to survive a
 * screenshot and a re-crop, low enough that it never competes with the French
 * underneath — this is material people read for hours at a stretch.
 */
async function pageOverlay(width: number, height: number, viewer: Viewer): Promise<Buffer> {
  const key = `${width}x${height} ${viewer.name} ${viewer.email}`
  const cached = overlayCache.get(key)
  if (cached) return cached

  const label = escapeXml(truncate(`${viewer.name} - ${viewer.email}`, 52))

  // Sized from the text rather than fixed: rotating a string makes it claim far
  // more height than its font size suggests, and a fixed box silently crops the
  // end of every longer email. DejaVu Sans averages ~0.56em per character, plus
  // the letter-spacing. Over-estimating wastes a few transparent pixels;
  // under-estimating loses the part that identifies the account.
  const textWidth = label.length * (TILE_FONT * 0.56 + 1.4)
  const radians = (TILE_ANGLE * Math.PI) / 180
  const tileW = Math.ceil(textWidth * Math.cos(radians)) + TILE_GAP
  const tileH = Math.ceil(textWidth * Math.sin(radians)) + TILE_FONT + TILE_GAP

  // Anchored bottom-left within its tile so the line rises to the top-right and
  // stays inside the box for any label length.
  const anchorX = Math.round(TILE_GAP / 2)
  const anchorY = tileH - Math.round(TILE_GAP / 2)

  const footerH = Math.max(30, Math.round(width * 0.032))
  const footerFont = Math.round(footerH * 0.42)
  const footerText = escapeXml(
    truncate(
      `Licensed to ${viewer.name} (${viewer.email}) — Français on Tips. Not for redistribution.`,
      Math.floor(width / (footerFont * 0.52)),
    ),
  )

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<defs>` +
      `<pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse">` +
      `<text x="${anchorX}" y="${anchorY}" ` +
      `transform="rotate(-${TILE_ANGLE} ${anchorX} ${anchorY})" ` +
      `font-family="${FONT_STACK}" font-size="${TILE_FONT}" font-weight="600" ` +
      `letter-spacing="1.4" fill="#16243F" fill-opacity="0.085">${label}</text>` +
      `</pattern>` +
      `</defs>` +
      `<rect width="${width}" height="${height}" fill="url(#wm)"/>` +
      `<rect x="0" y="${height - footerH}" width="${width}" height="${footerH}" ` +
      `fill="#16243F" fill-opacity="0.90"/>` +
      `<text x="${Math.round(footerH * 0.5)}" ` +
      `y="${height - Math.round(footerH / 2) + Math.round(footerFont * 0.36)}" ` +
      `font-family="${FONT_STACK}" font-size="${footerFont}" ` +
      `fill="#F8F5F0" fill-opacity="0.95">${footerText}</text>` +
      `</svg>`,
  )

  const overlay = await sharp(svg).png({ compressionLevel: 6 }).toBuffer()

  // Insertion-ordered, so the first key is the least recently added.
  if (overlayCache.size >= MAX_CACHED) {
    const oldest = overlayCache.keys().next().value
    if (oldest !== undefined) overlayCache.delete(oldest)
  }
  overlayCache.set(key, overlay)
  return overlay
}

/**
 * Reads a base page image and returns it watermarked as WebP.
 *
 * WebP because these are text pages read on phones over mobile data — it holds
 * accents and thin strokes better than JPEG at roughly half the bytes. Encoder
 * effort stays low: this runs per request, and effort above 2 costs more time
 * than the handful of kilobytes it saves.
 */
export async function watermarkPage(source: Buffer, viewer: Viewer): Promise<Buffer> {
  const base = sharp(source, { failOn: 'error' })
  const meta = await base.metadata()
  const width = meta.width ?? 1200
  const height = meta.height ?? 1600

  const overlay = await pageOverlay(width, height, viewer)

  return base
    .composite([{ input: overlay, top: 0, left: 0 }])
    .webp({ quality: 80, effort: 2 })
    .toBuffer()
}

/**
 * Turns a PDF into the page images the reader serves.
 *
 *   pnpm ingest --pdf ./material.pdf --slug tef-guide --title "TEF Canada Guide" --price 28 --price-inr 1899
 *
 * Runs on a laptop, never in production: `pdftoppm` (poppler) is a system
 * binary that Vercel does not have. The output is committed-adjacent content
 * under content/pages/, which is gitignored — it is paid material and must not
 * reach a public repo.
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { db, materialPages, products } from '../db'
import { PAGES_DIR } from '../lib/content'

const run = promisify(execFile)

/** 150dpi is the point where accented French text stays crisp at full width
 *  without the file size that makes a phone on mobile data give up. */
const DEFAULT_DPI = 150
/**
 * The reader column is 768px, so 1400 covers a 2x desktop display and a 3x
 * phone. Beyond this the extra pixels are discarded by every screen the
 * material is read on, and cost watermarking time on every single request.
 */
const MAX_WIDTH = 1400

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

function required(name: string): string {
  const value = arg(name)
  if (!value) {
    console.error(`Missing --${name}`)
    console.error(
      'Usage: pnpm ingest --pdf <file> --slug <slug> --title <title> --price <CAD> --price-inr <INR> [--dpi 150]',
    )
    process.exit(1)
  }
  return value
}

async function main() {
  const pdfPath = path.resolve(required('pdf'))
  const slug = required('slug')
  const title = required('title')
  const priceCad = Number(required('price'))
  const priceInr = Number(required('price-inr'))
  const dpi = Number(arg('dpi') ?? DEFAULT_DPI)
  const summary = arg('summary') ?? ''

  if (!Number.isFinite(priceCad) || priceCad <= 0) {
    console.error('--price must be a positive amount in Canadian dollars, e.g. 28')
    process.exit(1)
  }
  if (!Number.isFinite(priceInr) || priceInr <= 0) {
    console.error('--price-inr must be a positive amount in Indian rupees, e.g. 1899')
    process.exit(1)
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error('--slug must be lowercase letters, digits and dashes')
    process.exit(1)
  }

  const outDir = path.join(PAGES_DIR, slug)
  const tmpDir = path.join(outDir, '.raw')

  console.log(`Rendering ${path.basename(pdfPath)} at ${dpi}dpi…`)
  // Cleared first so a re-run after removing pages from the source PDF does not
  // leave orphaned images that outnumber the new page count.
  await rm(outDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })

  try {
    await run('pdftoppm', ['-png', '-r', String(dpi), pdfPath, path.join(tmpDir, 'page')])
  } catch (error) {
    console.error('pdftoppm failed. Is poppler installed?  (sudo pacman -S poppler)')
    throw error
  }

  const rendered = (await readdir(tmpDir))
    .filter((name) => name.endsWith('.png'))
    // pdftoppm zero-pads to the page count, so a plain sort is already correct —
    // but a numeric sort survives a future change to that convention.
    .sort((a, b) => Number(a.match(/(\d+)\.png$/)?.[1]) - Number(b.match(/(\d+)\.png$/)?.[1]))

  if (rendered.length === 0) throw new Error('pdftoppm produced no pages')
  console.log(`${rendered.length} pages rendered. Converting…`)

  const pages: { pageNumber: number; imagePath: string; width: number; height: number }[] = []

  for (const [index, file] of rendered.entries()) {
    const pageNumber = index + 1
    const name = `${String(pageNumber).padStart(4, '0')}.jpg`
    const target = path.join(outDir, name)

    // JPEG rather than WebP for the stored page. These are decoded on every
    // request before the watermark goes on, and JPEG decodes noticeably faster;
    // the reader is served WebP regardless, so the buyer's bandwidth is
    // unaffected. Quality is high enough that re-encoding to WebP afterwards
    // does not show the double compression.
    const output = await sharp(path.join(tmpDir, file))
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })

    await writeFile(target, output.data)
    pages.push({
      pageNumber,
      // Relative to PAGES_DIR — `resolvePagePath` refuses anything that escapes it.
      imagePath: path.join(slug, name),
      width: output.info.width,
      height: output.info.height,
    })
    if (pageNumber % 10 === 0) console.log(`  …${pageNumber}/${rendered.length}`)
  }

  await rm(tmpDir, { recursive: true, force: true })

  const [existing] = await db.select().from(products).where(eq(products.slug, slug)).limit(1)

  const productId = existing
    ? (await db
        .update(products)
        .set({
          title,
          priceCents: Math.round(priceCad * 100),
          priceInrPaise: Math.round(priceInr * 100),
          pageCount: pages.length,
          ...(summary ? { summary } : {}),
        })
        .where(eq(products.id, existing.id))
        .returning({ id: products.id }))[0].id
    : (await db
        .insert(products)
        .values({
          slug,
          title,
          summary,
          // Pages are the whole point of this path; a service product is made
          // with `pnpm grant --add-service` instead.
          kind: 'reader',
          priceCents: Math.round(priceCad * 100),
          priceInrPaise: Math.round(priceInr * 100),
          pageCount: pages.length,
          // Deliberately off. Rendering is not the same as being ready to sell —
          // flip it on once you have looked at the pages.
          isActive: false,
        })
        .returning({ id: products.id }))[0].id

  await db.delete(materialPages).where(eq(materialPages.productId, productId))
  await db.insert(materialPages).values(pages.map((page) => ({ ...page, productId })))

  console.log(`\nDone. ${pages.length} pages stored for "${title}".`)
  console.log(`Images: ${outDir}`)
  if (!existing) {
    console.log(
      `\nThe product is INACTIVE. Review the pages, then publish it:\n` +
        `  pnpm grant --publish ${slug}`,
    )
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

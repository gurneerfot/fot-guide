import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db, materialPages } from '@/db'

/**
 * Paid page images live here — outside `public/`, so Next never serves them
 * statically and the only way to a page is through the entitlement check in
 * the route handler.
 */
export const PAGES_DIR = path.join(process.cwd(), 'content', 'pages')

/**
 * Resolves a stored path inside PAGES_DIR, or throws.
 *
 * `imagePath` comes from our own database rather than a request, so this is
 * defence in depth — but an ingest bug that wrote `../../.env` into a row
 * should fail loudly here rather than read it.
 */
export function resolvePagePath(imagePath: string): string {
  const resolved = path.resolve(PAGES_DIR, imagePath)
  const root = path.resolve(PAGES_DIR)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`page path escapes the content directory: ${imagePath}`)
  }
  return resolved
}

/** The raw, un-watermarked page. Never returned to a client as-is. */
export async function readPageImage(
  productId: string,
  pageNumber: number,
): Promise<Buffer | null> {
  const [row] = await db
    .select({ imagePath: materialPages.imagePath })
    .from(materialPages)
    .where(
      and(eq(materialPages.productId, productId), eq(materialPages.pageNumber, pageNumber)),
    )
    .limit(1)

  if (!row) return null
  try {
    return await readFile(resolvePagePath(row.imagePath))
  } catch {
    // A row with no file behind it is a broken ingest, not a missing page.
    return null
  }
}

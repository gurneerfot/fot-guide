import { and, eq, isNull } from 'drizzle-orm'
import { db, entitlements, materialPages, products } from '@/db'

export type Product = typeof products.$inferSelect

/**
 * The storefront listing. Inactive products are invisible, not greyed out.
 *
 * Ordered so hosted material leads and the human-delivered services follow —
 * the guide is the thing a visitor can buy and open immediately.
 *
 * `createdAt` breaks ties. Without it two items at the same price come back in
 * whatever order Postgres finds them, which is not stable between requests —
 * the cards would swap places on a refresh for no reason the visitor can see.
 */
export async function activeProducts(): Promise<Product[]> {
  return db
    .select()
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(products.kind, products.priceCents, products.createdAt)
}

export async function productBySlug(slug: string): Promise<Product | null> {
  const [row] = await db.select().from(products).where(eq(products.slug, slug)).limit(1)
  return row ?? null
}

/**
 * The single gate. Every page image and every reader route asks this and
 * nothing else, so revoking an entitlement takes effect on the next request
 * rather than at the end of a session.
 */
export async function hasAccess(userId: string, productId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.userId, userId),
        eq(entitlements.productId, productId),
        isNull(entitlements.revokedAt),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/**
 * What this buyer owns, for the library screen after login.
 *
 * Only ever `reader` products in practice — a service purchase grants no
 * entitlement, because there is nothing here to open.
 */
export async function libraryFor(userId: string): Promise<Product[]> {
  return db
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      summary: products.summary,
      kind: products.kind,
      priceCents: products.priceCents,
      listPriceCents: products.listPriceCents,
      priceInrPaise: products.priceInrPaise,
      listPriceInrPaise: products.listPriceInrPaise,
      pageCount: products.pageCount,
      isActive: products.isActive,
      createdAt: products.createdAt,
    })
    .from(entitlements)
    .innerJoin(products, eq(products.id, entitlements.productId))
    .where(and(eq(entitlements.userId, userId), isNull(entitlements.revokedAt)))
}

export type PageMeta = { pageNumber: number; width: number; height: number }

/**
 * Dimensions only — never the file path. The reader needs to reserve layout
 * space per page, and shipping `imagePath` to the browser would put the
 * on-disk name of paid content into the DOM for no benefit.
 */
export async function pageIndex(productId: string): Promise<PageMeta[]> {
  return db
    .select({
      pageNumber: materialPages.pageNumber,
      width: materialPages.width,
      height: materialPages.height,
    })
    .from(materialPages)
    .where(eq(materialPages.productId, productId))
    .orderBy(materialPages.pageNumber)
}

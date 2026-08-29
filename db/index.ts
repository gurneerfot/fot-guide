import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless'
import { drizzle as drizzleNode } from 'drizzle-orm/node-postgres'
import { Pool as NodePool } from 'pg'
import * as schema from './schema'

// Node 22+ ships a global WebSocket, so the Neon driver needs no shim here.
neonConfig.poolQueryViaFetch = false

declare global {
  var __fotStudyDb: Database | undefined
}

type Database = ReturnType<typeof drizzleNeon<typeof schema>>

/**
 * Neon's driver talks WebSocket to a Neon endpoint and cannot reach a plain
 * Postgres, so local development would otherwise need a proxy container just
 * to run the app. Production always matches the first branch.
 */
function isLocal(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)[:/]/.test(url)
}

function connect(): Database {
  if (globalThis.__fotStudyDb) return globalThis.__fotStudyDb

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const database = isLocal(url)
    ? (drizzleNode(new NodePool({ connectionString: url }), { schema }) as unknown as Database)
    : drizzleNeon(new NeonPool({ connectionString: url }), { schema })

  // Reused across hot reloads in dev and warm invocations in production.
  globalThis.__fotStudyDb = database
  return database
}

/**
 * Connects on first use, not on import.
 *
 * `next build` imports every route module to analyse it, so an eager pool here
 * would make the build fail on any machine without DATABASE_URL — including CI
 * that only ever needs to typecheck. Deferring it means the error arrives at
 * the first query, where it is actionable, and names the missing variable.
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const active = connect() as unknown as Record<string | symbol, unknown>
    const value = active[property]
    // Drizzle's methods read internal state off the instance, so they must stay
    // bound to it rather than to the proxy.
    return typeof value === 'function' ? value.bind(active) : value
  },
})

export type Db = Database
export * from './schema'

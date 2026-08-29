import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// .env.local wins, matching Next.js' own precedence.
loadEnv({ path: '.env.local', quiet: true })
loadEnv({ path: '.env', quiet: true })

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set (looked in .env.local, then .env)')

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})

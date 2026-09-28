/**
 * Refuses to go on unless DATABASE_URL points at this machine.
 *
 * The check scripts delete rows. `.env.local` points at the live Neon database,
 * where real buyers' access lives, so a destructive script must never be one
 * forgotten environment variable away from it.
 */
export function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (!/@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)[:/]/.test(url)) {
    console.error(
      'Refusing to run: this script deletes data, and DATABASE_URL is not a local database.\n' +
        'Run it as: DATABASE_URL=postgresql://postgres:dev@localhost:55432/fot_study_dev pnpm <script>',
    )
    process.exit(1)
  }
}

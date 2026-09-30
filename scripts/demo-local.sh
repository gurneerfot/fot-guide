#!/usr/bin/env bash
#
# Runs the whole site on this machine against a throwaway Postgres, so demo
# booking can be tried end to end without going near production.
#
#   pnpm demo:local                 # emails off
#   DEMO_EMAILS=on pnpm demo:local  # real emails via Resend — book with your own address
#
# `.env.local` points at the live database and holds live Razorpay keys. Every
# value that could reach either is overridden here, and Next.js never lets a
# `.env` file replace a variable already set in the environment.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=fot-study-pg
LOCAL_DB=postgresql://postgres:dev@localhost:55432/fot_study_dev
PASSWORD=demo-local-password
PORT=${PORT:-3000}

# Next allows one dev server per project. If one is already up it was almost
# certainly started with plain `pnpm dev` — on the live database — and anything
# typed into localhost would land there, not in the throwaway copy.
if pgrep -f "next-server|next dev" >/dev/null || (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  cat >&2 <<EOF
Another Next.js dev server is already running (or port $PORT is taken).

If it was started with plain \`pnpm dev\`, it is using .env.local — the LIVE
database and live Razorpay keys. Stop it (Ctrl+C in its terminal), then run
\`pnpm demo:local\` again.
EOF
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Starting a throwaway Postgres ($CONTAINER)…"
  docker run -d --rm --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=fot_study_dev \
    -p 55432:5432 postgres:17-alpine >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -q -U postgres 2>/dev/null && break
    sleep 1
  done
fi

export DATABASE_URL=$LOCAL_DB
pnpm -s db:migrate >/dev/null
echo "Local database is migrated."

# Checkout off: the storefront would otherwise open real orders on live keys.
export RAZORPAY_KEY_ID= RAZORPAY_KEY_SECRET= RAZORPAY_WEBHOOK_SECRET=

if [[ "${DEMO_EMAILS:-}" != "on" ]]; then
  export RESEND_API_KEY=
  EMAILS="off (printed as 'skipping send' in this terminal)"
else
  EMAILS="ON — real emails will be sent"
fi

export ADMIN_PASSWORD_HASH
ADMIN_PASSWORD_HASH=$(node -e "
  const { hashSync } = require('@node-rs/argon2')
  process.stdout.write(Buffer.from(hashSync(process.argv[1], { memoryCost: 19456, timeCost: 2, parallelism: 1 })).toString('base64'))
" "$PASSWORD")
export ADMIN_SESSION_SECRET
ADMIN_SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))")
export ADMIN_EMAIL=${ADMIN_EMAIL:-francaisontips@gmail.com}
export ADMIN_TIME_ZONE=${ADMIN_TIME_ZONE:-Asia/Kolkata}
export NEXT_PUBLIC_DEMO_BOOKING=on
export NEXT_PUBLIC_SITE_URL=http://localhost:$PORT

if grep -q '^GOOGLE_REFRESH_TOKEN=..' .env.local 2>/dev/null; then
  MEET="automatic (real events on your Google Calendar)"
else
  MEET="paste a link per slot (Google not connected)"
fi

cat <<EOF

  Booking page   http://localhost:$PORT/demo
  Admin          http://localhost:$PORT/admin     password: $PASSWORD
  Emails         $EMAILS
  Meet links     $MEET

  Database: local throwaway copy. Production is not touched.
  Stop with Ctrl+C. Remove the database with: docker stop $CONTAINER

EOF

exec pnpm dev -p "$PORT"

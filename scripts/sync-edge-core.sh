#!/usr/bin/env bash
# Edge functions run on Deno and cannot resolve a workspace package, so the
# parts of @cortex/core they use are bundled into each function directory as a
# single self-contained `core.js`.
#
# Only the called functions are in the entry point, which lets esbuild tree-shake
# the zod-backed domain layer away: the result is ~23 kB rather than ~260 kB.
#
# The shared Supabase helpers are copied in the same way, so each function
# directory is self-contained at deploy time while `_shared/` stays the single
# source of truth in the repository.
#
# The generated files are not committed; run this before `supabase functions deploy`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Each function gets a bundle of exactly what it imports, so digest-build does
# not carry the feed parser and monitor-fetch does not carry the digest builder.
declare -A EXPORTS=(
  [monitor-fetch]="export { parseFeed, normalizeEntry, dedupe, canonicalizeUrl } from 'ROOT/packages/core/dist/monitor/feeds.js';
export { scoreItemAgainstTopics, selectRealtimeAlerts } from 'ROOT/packages/core/dist/monitor/ranking.js';"
  [digest-build]="export { buildDigest } from 'ROOT/packages/core/dist/monitor/digest.js';"
)

# google-calendar-sync talks only to Google and Postgres, so it needs the shared
# helpers but nothing from the core.
SHARED_ONLY=(google-calendar-sync)

npm run build:core --prefix "$ROOT" >/dev/null

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for fn in "${!EXPORTS[@]}"; do
  echo "${EXPORTS[$fn]//ROOT/$ROOT}" > "$STAGE/entry.js"
  npx --prefix "$ROOT" esbuild "$STAGE/entry.js" \
    --bundle --format=esm --platform=neutral --target=es2022 --minify \
    --outfile="$ROOT/supabase/functions/$fn/core.js" \
    --log-level=warning
  cp "$ROOT/supabase/functions/_shared/supabase.ts" "$ROOT/supabase/functions/$fn/shared.ts"
  echo "prepared supabase/functions/$fn ($(wc -c < "$ROOT/supabase/functions/$fn/core.js") bytes of core)"
done

for fn in "${SHARED_ONLY[@]}"; do
  cp "$ROOT/supabase/functions/_shared/supabase.ts" "$ROOT/supabase/functions/$fn/shared.ts"
  echo "prepared supabase/functions/$fn (shared helpers only)"
done

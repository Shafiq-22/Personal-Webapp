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
FUNCTIONS=(monitor-fetch digest-build google-calendar-sync)

npm run build:core --prefix "$ROOT" >/dev/null

ENTRY="$(mktemp -d)/entry.js"
cat > "$ENTRY" <<ENTRY_EOF
export { parseFeed, normalizeEntry, dedupe, canonicalizeUrl } from '$ROOT/packages/core/dist/monitor/feeds.js';
export { scoreItemAgainstTopics, selectRealtimeAlerts, bestScorePerItem } from '$ROOT/packages/core/dist/monitor/ranking.js';
export { buildDigest } from '$ROOT/packages/core/dist/monitor/digest.js';
ENTRY_EOF

for fn in "${FUNCTIONS[@]}"; do
  npx --prefix "$ROOT" esbuild "$ENTRY" \
    --bundle --format=esm --platform=neutral --target=es2022 \
    --outfile="$ROOT/supabase/functions/$fn/core.js" \
    --log-level=warning
  cp "$ROOT/supabase/functions/_shared/supabase.ts" "$ROOT/supabase/functions/$fn/shared.ts"
  echo "prepared supabase/functions/$fn ($(wc -c < "$ROOT/supabase/functions/$fn/core.js") bytes of core)"
done

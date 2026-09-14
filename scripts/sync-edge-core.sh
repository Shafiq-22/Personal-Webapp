#!/usr/bin/env bash
# Edge functions run on Deno and cannot resolve a workspace package, so the
# compiled core is copied next to them as plain ESM before serving/deploying.
# The copy is generated output and is not committed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
npm run build:core --prefix "$ROOT" >/dev/null
TARGET="$ROOT/supabase/functions/_shared/core"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -R "$ROOT/packages/core/dist/." "$TARGET/"
find "$TARGET" -name '*.map' -delete
echo "copied @cortex/core -> supabase/functions/_shared/core"

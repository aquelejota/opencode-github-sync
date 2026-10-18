#!/usr/bin/env bash
# Rebuilds the fork and mirrors dist/ into the synced config's vendor/.
#
# The two machines run the plugin from `~/.config/opencode/vendor/`, which
# travels through the sync repository — so a code change is: build, copy here,
# restart the service there too. This script is that first half, done the same
# way every time (the manual `cp -a dist/. ...` was repeated by hand a lot).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="${VENDOR_DIR:-$HOME/.config/opencode/vendor/opencode-github-sync/dist}"
cd "$ROOT"

npm run build
mkdir -p "$VENDOR"
rsync -a --delete dist/ "$VENDOR/"

echo
echo "--- build-info ---"
cat dist/build-info.json
echo "vendor: $VENDOR"
echo
echo "Falta: opencode service restart   (o service nao faz hot-reload de plugin)"
echo "Outra maquina: pull do sync + opencode service restart"

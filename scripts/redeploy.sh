#!/usr/bin/env bash
# Rebuild the desk and publish it, plus the demo pack, to here.now.
#
#   ./scripts/redeploy.sh --dry-run     # build and report what would be uploaded
#   ./scripts/redeploy.sh               # actually publish (asks for nothing: publishing is
#                                       # a protected action, so only run this on approval)
#
# Prints the live URL and the claim URL of each publish. The claim URL is
# credential-equivalent: it hands ownership of the site to whoever opens it first.
set -euo pipefail

REPO=/home/amanda/cargolinx-v2
PACK=/home/amanda/out/publish
PUB=/home/amanda/swarm/hackathon/publish_herenow.py
PY="${PY:-/home/amanda/.venvs/pdfvenv/bin/python}"
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

cd "$REPO"
echo "== build"
# build into dist-pub, not dist: an earlier root-owned dist/sw.js makes dist unwritable
rm -rf dist-pub
npx vite build --outDir dist-pub --emptyOutDir >/tmp/redeploy-build.log 2>&1 || {
  echo "build failed:"; tail -20 /tmp/redeploy-build.log; exit 1; }
SIZE=$(du -sk dist-pub | cut -f1)
FILES=$(find dist-pub -type f | wc -l)
echo "   dist-pub: ${FILES} files, ${SIZE} KiB"

# the desk as its own site
SITE=$(mktemp -d)
cp -r dist-pub/* "$SITE"/
cp -r "$REPO/.herenow" "$SITE"/.herenow 2>/dev/null || true
rm -rf "$SITE"/.herenow/publishes 2>/dev/null || true

if [[ $DRY -eq 1 ]]; then
  echo "== dry run: desk"
  "$PY" "$PUB" "$SITE" --dry-run | tail -4
  echo "== dry run: demo pack"
  "$PY" "$PUB" "$PACK" --dry-run | tail -4
  echo "nothing was published"
  rm -rf "$SITE"
  exit 0
fi

echo "== publish: desk"
"$PY" "$PUB" "$SITE" | tee /tmp/redeploy-desk.json
echo "== publish: demo pack"
"$PY" "$PUB" "$PACK" | tee /tmp/redeploy-pack.json
rm -rf "$SITE"

echo
echo "Desk URL:   $(grep -o 'https://[a-z-]*\.here\.now' /tmp/redeploy-desk.json | head -1)"
echo "Pack URL:   $(grep -o 'https://[a-z-]*\.here\.now' /tmp/redeploy-pack.json | head -1)"
echo "Claim both from the JSON above within the hour, or they expire."

#!/usr/bin/env bash
# Publish the static Pages tree (dist-pages/) to gh-pages, fast-forward only.
# The entry-film page lives in dist-pages/demo/ and MUST travel with every deploy:
# commit d321716 rebuilt gh-pages without it and /cargolinx/demo/ began returning 404.
set -euo pipefail
REPO=/home/amanda/cargolinx-v2
SRC=$REPO/dist-pages
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1
cd "$REPO"
for f in index.html demo/index.html demo/cargolinx-demo-entry-153s.mp4 .nojekyll; do
  [[ -f "$SRC/$f" ]] || { echo "MISSING $f in dist-pages - refusing to deploy"; exit 2; }
done
echo "tree ok: $(find "$SRC" -type f | wc -l) files, $(du -sk "$SRC" | cut -f1) KiB"
echo "film: $(du -h "$SRC/demo/cargolinx-demo-entry-153s.mp4" | cut -f1)"
if [[ $DRY -eq 1 ]]; then echo "dry run only - nothing pushed"; exit 0; fi
TMP=$(mktemp -d)
git clone -q --branch gh-pages github "$TMP/pages"
cp -a "$SRC"/. "$TMP/pages"/
cd "$TMP/pages"
git add -A
git commit -q -m "deploy: static Pages tree including the entry-film page at /cargolinx/demo/" || echo "nothing to commit"
git push github gh-pages
echo "pushed to gh-pages; pages rebuild takes about a minute"

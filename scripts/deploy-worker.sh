#!/usr/bin/env bash
# Deploy the approved cut to the CargoLinx worker and prove the live file by checksum.
# Token is read from the sealed vault and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

TOK="$(/home/amanda/vault/bin/vault-get CLOUDFLARE_API_TOKEN)"
export CLOUDFLARE_API_TOKEN="$TOK"

echo "== token check"
node -e '
const t=process.env.CLOUDFLARE_API_TOKEN;
fetch("https://api.cloudflare.com/client/v4/accounts",{headers:{Authorization:"Bearer "+t}})
 .then(r=>r.json()).then(d=>{
   if(!d.success){console.error("REFUSED:",JSON.stringify(d.errors));process.exit(2);}
   const a=d.result[0]; console.log("account", a.id, a.name);
   console.log("ACCOUNT_ID="+a.id);
 }).catch(e=>{console.error("network:",e.message);process.exit(3);});' | tee /tmp/cf_acct.txt

ACCT="$(grep -o 'ACCOUNT_ID=.*' /tmp/cf_acct.txt | cut -d= -f2)"
[ -n "$ACCT" ] || { echo "no account id"; exit 4; }
export CLOUDFLARE_ACCOUNT_ID="$ACCT"

echo "== deploy"
npx --yes wrangler@latest deploy 2>&1 | tail -15

echo "== verify live film"
LOCAL="$(sha256sum public/demo/cargolinx-demo-entry-153s.mp4 | cut -d' ' -f1)"
for i in 1 2 3 4 5; do
  LIVE_URL="https://altovexcargolinx.allansande74.workers.dev/demo/cargolinx-demo-entry-153s.mp4?cb=$RANDOM"
  LIVE_SUM="$(curl -s "$LIVE_URL" | sha256sum | cut -d' ' -f1)"
  if [ "$LIVE_SUM" = "$LOCAL" ]; then
    echo "MATCH  local $LOCAL"
    echo "MATCH  live  $LIVE_SUM"
    exit 0
  fi
  echo "attempt $i: live ${LIVE_SUM:0:12} != local ${LOCAL:0:12}; waiting"
  sleep 30
done
echo "MISMATCH after retries"; exit 5

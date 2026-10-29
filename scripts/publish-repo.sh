#!/bin/bash
# Publish this repository to GitHub using a token that arrives as a file.
# The token is never printed, never passed on a command line, never written to git config.
set -euo pipefail
REPO_DIR=/home/amanda/cargolinx-v2
TOKEN_FILE=${1:-/home/amanda/.secrets/github.token}
OWNER=${2:-}
NAME=${3:-cargolinx}

[ -r "$TOKEN_FILE" ] || { echo "No readable token file at $TOKEN_FILE"; exit 2; }
TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
[ -n "$TOKEN" ] || { echo "Token file is empty"; exit 3; }

cd "$REPO_DIR"

# who is this token?
API_USER=$(curl -s -m 20 -H "Authorization: Bearer $TOKEN" https://api.github.com/user | sed -n 's/.*"login": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$API_USER" ] || { echo "Token did not authenticate"; exit 4; }
[ -n "$OWNER" ] || OWNER=$API_USER

echo "Authenticated as $API_USER; target $OWNER/$NAME"

# create the repository if it does not exist (private first; the hackathon needs it public)
curl -s -m 30 -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
     -d "{\"name\":\"$NAME\",\"description\":\"CargoLinx - freight position, real ETA and true landed cost for East African traders. Meta Global AI Developer Hackathon entry.\",\"private\":true,\"has_issues\":true,\"has_wiki\":false}" \
     https://api.github.com/user/repos > /tmp/gh_create.json
grep -q '"full_name"' /tmp/gh_create.json || sed -n 's/.*"message": *"\([^"]*\)".*/create said: \1/p' /tmp/gh_create.json

git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:$TOKEN@github.com/$OWNER/$NAME.git"
git push -u origin HEAD:main
git remote set-url origin "https://github.com/$OWNER/$NAME.git"

echo "Pushed. Repository: https://github.com/$OWNER/$NAME"

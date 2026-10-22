#!/usr/bin/env bash
# Sets up the Claude routine on this computer: stores the sync key and your searches in ~/.flat-hunt
# and writes the routine prompt with your site address filled in.
set -euo pipefail

DIR="$HOME/.flat-hunt"
SKILL="$(cd "$(dirname "$0")/.." && pwd)/routine/SKILL.md"
[ -f "$SKILL" ] || { echo "routine/SKILL.md not found next to this script." >&2; exit 1; }

read -r -p "Your site address (e.g. https://my-flat-hunt.up.railway.app): " SITE
SITE="${SITE%/}"
case "$SITE" in https://*|http://localhost*|http://127.0.0.1*) ;; *) echo "The address must start with https://" >&2; exit 1 ;; esac

read -r -s -p "Your SYNC_KEY (input hidden): " KEY; echo
[ -n "$KEY" ] || { echo "The sync key is empty." >&2; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-sync-key: $KEY" "$SITE/api/profile" || true)
case "$code" in
  200) echo "Connected: the site accepts the key." ;;
  404) echo "Connected, but the site has no profile yet: finish the setup wizard on the site before the first run." ;;
  401) echo "The site refused the key. Check SYNC_KEY on your server." >&2; exit 1 ;;
  503) echo "SYNC_KEY is not set on your server." >&2; exit 1 ;;
  *)   echo "Could not reach $SITE (HTTP $code)." >&2; exit 1 ;;
esac

mkdir -p "$DIR" && chmod 700 "$DIR"
printf '%s' "$KEY" > "$DIR/sync-key" && chmod 600 "$DIR/sync-key"

echo
echo "Paste your saved search result URLs from Immowelt, Kleinanzeigen and WG-Gesucht, one per line."
echo "Keep each search to three result pages or fewer. Press Enter on an empty line to finish."
: > "$DIR/searches.txt.new"
while IFS= read -r line; do
  [ -z "$line" ] && break
  case "$line" in
    *immobilienscout24.de*) echo "  skipped: ImmoScout24 is manual only, add its listings by hand" ;;
    https://*) printf '%s\n' "$line" >> "$DIR/searches.txt.new" ;;
    *) echo "  skipped: not an https:// address" ;;
  esac
done
if [ -s "$DIR/searches.txt.new" ]; then mv "$DIR/searches.txt.new" "$DIR/searches.txt"; else rm -f "$DIR/searches.txt.new"; fi
[ -f "$DIR/searches.txt" ] && echo "Searches saved: $(wc -l < "$DIR/searches.txt" | tr -d ' ')" || echo "No searches saved yet; add them to $DIR/searches.txt later."

sed "s#https://YOUR-SITE.up.railway.app#$SITE#" "$SKILL" > "$DIR/routine-prompt.md"
command -v pbcopy >/dev/null && pbcopy < "$DIR/routine-prompt.md" && copied=" (also copied to the clipboard)" || copied=""

cat <<EOF

Done. The routine prompt is in $DIR/routine-prompt.md$copied.

Last step, in the Claude desktop app:
  1. Create a new scheduled task named "flat-hunt-listing-check", running every 3 hours during the day.
  2. Paste the routine prompt as its instructions.
  3. Make sure Claude in Chrome is connected and Chrome is logged in to the portals and your email.
Nothing is sent to landlords until you switch it on in Settings -> Contacting landlords and approve templates.
EOF

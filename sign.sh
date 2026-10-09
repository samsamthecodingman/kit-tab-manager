#!/usr/bin/env bash
# Has Mozilla sign the extension so Firefox installs it permanently.
#   ./sign.sh           private (unlisted): signs and downloads the .xpi into web-ext-artifacts/
#   ./sign.sh --listed  public: submits the version to the addons.mozilla.org listing for review
# Needs an AMO API key: addons.mozilla.org → Developer Hub → Tools → Manage API Keys.
# The key and secret are read from WEB_EXT_API_KEY / WEB_EXT_API_SECRET, or asked for (secret hidden).
set -euo pipefail
cd "$(dirname "$0")"

channel=unlisted
case "${1:-}" in
  "") ;;
  --listed) channel=listed ;;
  *) echo "usage: $0 [--listed]" >&2; exit 2 ;;
esac

if [[ -z "${WEB_EXT_API_KEY:-}" ]]; then
  read -rp "AMO API key (JWT issuer, starts with user:): " WEB_EXT_API_KEY
fi
if [[ -z "${WEB_EXT_API_SECRET:-}" ]]; then
  read -rsp "AMO API secret (hidden): " WEB_EXT_API_SECRET
  echo
fi
export WEB_EXT_API_KEY WEB_EXT_API_SECRET

version=$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')
echo "Checking and submitting Kit $version ($channel). Mozilla won't sign the same version twice…"

npx --yes web-ext@10 lint --source-dir extension
npx --yes web-ext@10 sign --channel="$channel" --source-dir extension --artifacts-dir web-ext-artifacts

echo
if [[ $channel == listed ]]; then
  echo "Submitted. Mozilla reviews it, then Firefox updates everyone who installed Kit from addons.mozilla.org."
else
  echo "Signed. Open the .xpi in web-ext-artifacts/ with Firefox and click Add to install it."
fi

#!/usr/bin/env bash
# Has Mozilla sign the extension as an unlisted (private) add-on, so Firefox installs it permanently.
# It never appears on addons.mozilla.org. Needs an AMO API key: addons.mozilla.org → Tools → Manage API Keys.
# The key and secret are read from WEB_EXT_API_KEY / WEB_EXT_API_SECRET, or asked for (secret hidden).
set -euo pipefail
cd "$(dirname "$0")"

if [[ -z "${WEB_EXT_API_KEY:-}" ]]; then
  read -rp "AMO API key (JWT issuer, starts with user:): " WEB_EXT_API_KEY
fi
if [[ -z "${WEB_EXT_API_SECRET:-}" ]]; then
  read -rsp "AMO API secret (hidden): " WEB_EXT_API_SECRET
  echo
fi
export WEB_EXT_API_KEY WEB_EXT_API_SECRET

version=$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')
echo "Checking and signing Kit $version (Mozilla won't sign the same version twice)…"

npx --yes web-ext@10 lint --source-dir extension
npx --yes web-ext@10 sign --channel=unlisted --source-dir extension --artifacts-dir web-ext-artifacts

echo
echo "Signed. Open the .xpi in web-ext-artifacts/ with Firefox and click Add to install it."

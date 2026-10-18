#!/usr/bin/env bash
# Copy the PWA's web assets into www/ for Capacitor to bundle.
# Run after editing the web app, before `npx cap sync ios`.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf www && mkdir -p www
cp index.html app.js config.js styles.css sw.js manifest.webmanifest www/
cp -R icons www/
echo "Synced web assets -> www/"

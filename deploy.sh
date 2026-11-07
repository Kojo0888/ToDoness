#!/bin/sh
# Builds the app locally and copies it to a remote server's release folder.
# The server runs docker-compose.folder.yml and restarts the app by itself;
# this script does not touch Docker. Needs Node 22, pnpm, rsync and ssh here.
#
# Usage: ./deploy.sh user@server:/path/to/todoness/release
#    or: DEPLOY_TARGET=user@server:/path/to/todoness/release ./deploy.sh
set -eu
cd "$(dirname "$0")"

target="${1:-${DEPLOY_TARGET:-}}"
if [ -z "$target" ]; then
  echo "Usage: $0 user@server:/path/to/todoness/release" >&2
  exit 1
fi

# --ignore-scripts: nothing native is needed to build. The server installs the
# native modules itself, inside its container.
pnpm install --frozen-lockfile --ignore-scripts \
  --filter "@todoness/client..." --filter "@todoness/server..."
pnpm --filter @todoness/client build
pnpm --filter @todoness/server build

# Assemble the same layout the container expects in /app.
rm -rf ./release
mkdir -p ./release/public
cp -R server/dist/. ./release/
cp -R client/dist/. ./release/public/

# --delete removes files that no longer exist, but node_modules (installed on the
# server) is excluded so it survives. --delay-updates puts the new files in place
# at the end of the transfer, so the server never sees a half-copied release.
rsync -az --delete --delay-updates --exclude node_modules ./release/ "$target/"

echo "Uploaded to $target"

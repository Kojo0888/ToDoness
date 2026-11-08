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

# Safety checks. rsync --delete below makes the target an exact copy of the
# release, so a wrong target destroys whatever else lives there (docker-compose
# files, backups, the server's own ./release folder). That is also what causes
# "cannot delete non-empty directory: release": node_modules is excluded from
# deletion, so rsync cannot remove a folder that contains it.
case "$target" in
  */release | */release/) ;;
  *)
    echo "Refusing: the target must be the server's release folder (a path ending in /release), got: $target" >&2
    exit 1
    ;;
esac

case "$target" in
  *:*) host="${target%%:*}"; path="${target#*:}" ;;
  *) host=""; path="$target" ;;
esac

if [ -z "$host" ]; then
  # Local target: never deploy onto this checkout's own build folder; it is
  # deleted and rebuilt below, which would also break a running bind mount.
  if [ "$(cd "$path" 2>/dev/null && pwd -P)" = "$(pwd -P)/release" ]; then
    echo "Refusing: the target is this checkout's ./release, which is rebuilt on every run." >&2
    echo "Run deploy.sh from your build machine, or use ./update.sh on the server." >&2
    exit 1
  fi
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

# Never ship (and --delete the server's copy in favour of) an incomplete release.
for f in index.js package.json migrations public/index.html; do
  [ -e "./release/$f" ] || { echo "Build is incomplete: release/$f is missing" >&2; exit 1; }
done

# --delete removes files that no longer exist, but the top-level node_modules (installed on the
# server) is excluded so it survives. --delay-updates puts the new files in place
# at the end of the transfer, so the server never sees a half-copied release.
rsync -az --delete --delay-updates --exclude /node_modules ./release/ "$target/"

echo "Uploaded to $target"
echo "If the app container still fails, recreate it so it re-reads the folder:"
echo "  docker compose -f docker-compose.folder.yml up -d --force-recreate app"

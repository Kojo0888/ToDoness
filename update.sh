#!/bin/sh
# Builds the server and web app into ./release and restarts the app container.
# Use with docker-compose.folder.yml. Usage: ./update.sh [--pull]
set -eu
cd "$(dirname "$0")"

if [ "${1:-}" = "--pull" ]; then git pull --ff-only; fi

# Reuse the Dockerfile's build stage (cached unless dependencies or sources
# change), then copy its output out. Nothing is built on the host.
docker build --target build -t todoness-build .
id=$(docker create todoness-build)
trap 'docker rm -f "$id" >/dev/null' EXIT

rm -rf ./release.new
mkdir -p ./release.new/public
docker cp "$id:/app/server/dist/." ./release.new/
docker cp "$id:/app/client/dist/." ./release.new/public/

# Keep node_modules between updates so a restart only fetches what changed.
if [ -d ./release/node_modules ]; then mv ./release/node_modules ./release.new/node_modules; fi
rm -rf ./release.old
if [ -d ./release ]; then mv ./release ./release.old; fi
mv ./release.new ./release
rm -rf ./release.old

# Recreate the app container: the release folder was swapped, and a plain
# restart could keep the bind mount on the old directory.
docker compose -f docker-compose.folder.yml up -d --force-recreate app
docker compose -f docker-compose.folder.yml up -d
echo "Updated. Logs: docker compose -f docker-compose.folder.yml logs -f app"

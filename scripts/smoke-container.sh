#!/usr/bin/env bash
# Build-output smoke gate for the BonkLM server container.
set -euo pipefail

if [ "${1:-}" = "--" ]; then
  shift
fi

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <image> <expected-version> <expected-platform>" >&2
  exit 2
fi

image="$1"
expected_version="$2"
expected_platform="$3"
container_name="bonklm-smoke-$$"
secret="$(openssl rand -base64 48 | tr -d '\n')"
max_attempts="${SMOKE_MAX_ATTEMPTS:-30}"
sleep_seconds="${SMOKE_SLEEP_SECONDS:-1}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

image_user="$(docker image inspect --format '{{.Config.User}}' "$image")"
image_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image")"
image_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")"
package_version="$(docker run --rm --entrypoint node "$image" -p "require('./package.json').version")"

if [ "$image_user" != "bonklm" ]; then
  echo "FAIL: image user is '$image_user', expected 'bonklm'" >&2
  exit 1
fi
if [ "$image_version" != "$expected_version" ] || [ "$package_version" != "$expected_version" ]; then
  echo "FAIL: version drift (label=$image_version package=$package_version expected=$expected_version)" >&2
  exit 1
fi
if [ "$image_platform" != "$expected_platform" ]; then
  echo "FAIL: platform drift (image=$image_platform expected=$expected_platform)" >&2
  exit 1
fi
if ! docker run --rm --entrypoint sh "$image" -c \
  'test ! -w /app/packages/bonklm-server/package.json && test ! -w /app/packages/bonklm-server/dist/bin/server.js'; then
  echo "FAIL: application files are writable by the service user" >&2
  exit 1
fi
if ! docker run --rm --entrypoint sh "$image" -c \
  '! command -v npm && ! command -v npx && ! command -v pnpm && ! command -v yarn && ! command -v yarnpkg'; then
  echo "FAIL: runtime image retains a package manager" >&2
  exit 1
fi

docker run --detach --name "$container_name" \
  --publish 127.0.0.1::4123 \
  --env BONKLM_HMAC_SECRET="$secret" \
  --env BONKLM_TRUSTED_TLS_TERMINATION=true \
  "$image" >/dev/null

for _attempt in $(seq 1 "$max_attempts"); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_name")"
  if [ "$health" = "healthy" ]; then
    port="$(docker port "$container_name" 4123/tcp | head -1 | awk -F: '{print $NF}')"
    response="$(curl --connect-timeout 5 --max-time 10 --fail --silent --show-error "http://127.0.0.1:${port}/healthz")"
    if [ "$response" != '{"status":"ok"}' ]; then
      echo "FAIL: unexpected /healthz response: $response" >&2
      exit 1
    fi
    echo "PASS: $image runs non-root at version $expected_version and reports healthy"
    exit 0
  fi
  if [ "$health" = "unhealthy" ]; then
    docker logs "$container_name" >&2
    echo "FAIL: container became unhealthy" >&2
    exit 1
  fi
  sleep "$sleep_seconds"
done

docker logs "$container_name" >&2
echo "FAIL: container did not become healthy within ${max_attempts} attempt(s)" >&2
exit 1

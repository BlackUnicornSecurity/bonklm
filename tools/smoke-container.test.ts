import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mockBin = mkdtempSync(join(tmpdir(), 'bonklm-smoke-bin-'));

beforeAll(() => {
  mkdirSync(mockBin, { recursive: true });
  const docker = `#!/bin/sh
case "$1 $2" in
  "image inspect")
    case "$4" in
      *Config.User*) printf '%s\\n' "\${MOCK_IMAGE_USER:-bonklm}" ;;
      *Architecture*) printf '%s\\n' "\${MOCK_IMAGE_PLATFORM:-linux/amd64}" ;;
      *) printf '%s\\n' "\${MOCK_IMAGE_VERSION:-1.0.1}" ;;
    esac ;;
  "run --rm")
    case "$*" in
      *"command -v"*) [ "\${MOCK_PACKAGE_MANAGER_PRESENT:-false}" != true ] ;;
      *"--entrypoint sh"*) [ "\${MOCK_APP_WRITABLE:-false}" != true ] ;;
      *) printf '%s\\n' "\${MOCK_PACKAGE_VERSION:-1.0.1}" ;;
    esac ;;
  "run --detach") printf '%s\\n' "$*" > "$MOCK_DOCKER_START"; printf '%s\\n' container-id ;;
  "inspect --format") printf '%s\\n' "\${MOCK_HEALTH:-healthy}" ;;
  "port bonklm-smoke-"*) printf '%s\\n' '127.0.0.1:49152' ;;
  "logs bonklm-smoke-"*) printf '%s\\n' 'mock logs' ;;
  "rm -f") printf '%s\\n' "$*" > "$MOCK_DOCKER_CLEANUP" ;;
  *) printf 'unexpected docker arguments: %s\\n' "$*" >&2; exit 9 ;;
esac
`;
  const curl = `#!/bin/sh
printf '%s\\n' "$*" > "$MOCK_CURL_ARGS"
printf '%s\\n' "$MOCK_HEALTH_RESPONSE"
`;
  writeFileSync(join(mockBin, 'docker'), docker);
  writeFileSync(join(mockBin, 'curl'), curl);
  chmodSync(join(mockBin, 'docker'), 0o755);
  chmodSync(join(mockBin, 'curl'), 0o755);
});

afterAll(() => rmSync(mockBin, { recursive: true, force: true }));

function smoke(overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', ['scripts/smoke-container.sh', 'bonklm:test', '1.0.1', 'linux/amd64'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH}`,
      MOCK_CURL_ARGS: join(mockBin, 'curl-args'),
      MOCK_DOCKER_CLEANUP: join(mockBin, 'docker-cleanup'),
      MOCK_DOCKER_START: join(mockBin, 'docker-start'),
      MOCK_HEALTH_RESPONSE: '{"status":"ok"}',
      SMOKE_MAX_ATTEMPTS: '1',
      SMOKE_SLEEP_SECONDS: '0',
      ...overrides
    }
  });
}

describe('container smoke failure modes', () => {
  it('accepts only a matching non-root healthy image', () => {
    const result = smoke();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('runs non-root at version 1.0.1');
    expect(readFileSync(join(mockBin, 'curl-args'), 'utf8')).toContain('--connect-timeout 5 --max-time 10');
    expect(readFileSync(join(mockBin, 'docker-cleanup'), 'utf8')).toContain('rm -f bonklm-smoke-');
    expect(readFileSync(join(mockBin, 'docker-start'), 'utf8')).toContain('--env BONKLM_TRUSTED_TLS_TERMINATION=true');
  });

  it.each([
    ['wrong runtime user', { MOCK_IMAGE_USER: 'root' }, /expected 'bonklm'/],
    ['label drift', { MOCK_IMAGE_VERSION: '1.0.0' }, /version drift/],
    ['package drift', { MOCK_PACKAGE_VERSION: '1.0.0' }, /version drift/],
    ['platform drift', { MOCK_IMAGE_PLATFORM: 'linux/arm64' }, /platform drift/],
    ['writable application code', { MOCK_APP_WRITABLE: 'true' }, /application files are writable/],
    ['runtime package manager', { MOCK_PACKAGE_MANAGER_PRESENT: 'true' }, /retains a package manager/],
    ['unhealthy container', { MOCK_HEALTH: 'unhealthy' }, /became unhealthy/],
    ['health timeout', { MOCK_HEALTH: 'starting' }, /did not become healthy/],
    ['wrong health body', { MOCK_HEALTH_RESPONSE: '{"status":"bad"}' }, /unexpected \/healthz response/]
  ])('fails on %s', (_label, env, message) => {
    const result = smoke(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
    expect(readFileSync(join(mockBin, 'docker-cleanup'), 'utf8')).toContain('rm -f bonklm-smoke-');
  });
});

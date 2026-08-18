import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const dockerfile = read('../packages/bonklm-server/Dockerfile');
const serverManifest = JSON.parse(read('../packages/bonklm-server/package.json')) as {
  scripts: Record<string, string>;
};
const workflow = read('../.github/workflows/publish.yml');
const ciWorkflow = read('../.github/workflows/ci.yml');
const qualityGate = read('../scripts/quality-gate.sh');

describe('container release surface', () => {
  it('builds a lockfile-frozen production workspace without legacy deploy re-resolution', () => {
    expect(serverManifest.scripts['docker:build']).toContain('--build-arg RELEASE_VERSION=');
    expect(serverManifest.scripts['docker:build']).toContain('--build-arg RELEASE_REVISION=');
    expect(serverManifest.scripts['docker:build']).toContain('-f Dockerfile ../..');
    expect(dockerfile).not.toContain(' pnpm --filter @blackunicorn/bonklm-server deploy ');
    expect(dockerfile).not.toContain('pnpm prune');
    expect(dockerfile).toContain('pnpm install --prod --offline --frozen-lockfile --ignore-scripts');
    expect(dockerfile).toContain('COPY --from=builder /workspace/node_modules ./node_modules');
    expect(dockerfile).toContain('COPY --from=builder /workspace/packages/core/node_modules');
    expect(dockerfile).toContain('COPY --from=builder /workspace/packages/bonklm-server/node_modules');
  });

  it('pins the runtime base and rejects image/package version drift', () => {
    expect(dockerfile).toContain(
      '# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e'
    );
    expect(dockerfile).toMatch(/ARG NODE_IMAGE=node:24-alpine@sha256:[0-9a-f]{64}/);
    expect(dockerfile).toContain('test "$PACKAGE_VERSION" = "$RELEASE_VERSION"');
    expect(dockerfile).toContain('org.opencontainers.image.version=$RELEASE_VERSION');
    expect(dockerfile).toContain('org.opencontainers.image.revision=$RELEASE_REVISION');
    expect(dockerfile).not.toContain('apk add');
    expect(dockerfile).toContain('/usr/local/lib/node_modules/npm');
    expect(dockerfile).toContain('/opt/yarn-');
    expect(dockerfile).toContain('/usr/local/bin/yarn');
    expect(dockerfile).toContain('USER bonklm');
  });

  it('publishes a scanned, signed multi-architecture image from the same release', () => {
    expect(workflow).toMatch(/artifact-preflight:\s*\n\s+name: Build and verify release artifacts/);
    expect(workflow).toMatch(/release-transaction:\s*\n\s+name: Publish and reconcile release/);
    expect(workflow).toContain('release-container.js ensure-exact');
    expect(workflow).toContain('--platform linux/amd64,linux/arm64');
    expect(workflow).toContain('--build-arg "RELEASE_REVISION=${{ needs.validate.outputs.sha }}"');
    // Scanner: pinned binary via the checksum-verified local composite —
    // third-party action code must NOT execute in this lane (removal pin:
    // the aquasecurity action reference is forbidden).
    expect(workflow).not.toContain('aquasecurity/');
    expect(workflow).toContain('uses: ./.github/actions/install-trivy');
    expect(workflow).toContain('--input bonklm-server-amd64.tar');
    expect(workflow).toContain('--input bonklm-server-arm64.tar');
    expect(workflow).toContain('--severity HIGH,CRITICAL');
    const composite = readFileSync('.github/actions/install-trivy/action.yml', 'utf8');
    expect(composite).toContain('sha256sum --check --strict');
    expect(composite).toMatch(/TRIVY_VERSION: \d+\.\d+\.\d+/);
    expect(composite).toMatch(/TRIVY_SHA256_AMD64: [0-9a-f]{64}/);
    expect(workflow.match(/scripts\/image-inventory\.mjs/g)).toHaveLength(2);
    expect(workflow).toContain('bonklm-server-amd64.inventory.json');
    expect(workflow).toContain('bonklm-server-arm64.inventory.json');
    expect(workflow).toContain(
      'node scripts/check-image-runtime.mjs bonklm-server-amd64.inventory.json bonklm-server-arm64.inventory.json'
    );
    expect(workflow).toContain('--provenance=false');
    expect(workflow).toContain('--sbom=false');
    expect(workflow).toContain('cosign sign --yes');
    expect(workflow.match(/pnpm run docker:smoke/g)).toHaveLength(2);
    expect(workflow).toContain('bonklm-server:amd64 "$VERSION" linux/amd64');
    expect(workflow).toContain('bonklm-server:arm64 "$VERSION" linux/arm64');
    expect(workflow).toContain('linux/amd64,linux/arm64');
    expect(ciWorkflow).toContain('"$VERSION" linux/amd64');
    expect(qualityGate).toContain("docker image inspect --format '{{.Os}}/{{.Architecture}}'");
    expect(qualityGate).toContain('"${VERSION}" "${IMAGE_PLATFORM}"');
    expect(workflow).toContain('bonklm-server.oci.tar');
  });

  it('publishes only immutable exact container versions', () => {
    expect(workflow).toContain('if [ "$PRERELEASE" = true ]; then CHANNEL=next; else CHANNEL=latest; fi');
    expect(workflow).toContain('"${IMAGE_NAME}:${RELEASE_VERSION}"');
    expect(workflow).toContain('STAGING_IMAGE: ghcr.io/blackunicornsecurity/bonklm-server-staging');
    expect(workflow).not.toContain('${IMAGE_NAME}:${CHANNEL}');
    expect(workflow).not.toContain('container-promote:');
  });
});

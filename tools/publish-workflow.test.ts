import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/publish.yml', import.meta.url)), 'utf8');
const recoveryWorkflow = readFileSync(
  fileURLToPath(new URL('../.github/workflows/recover-release.yml', import.meta.url)),
  'utf8'
);
const ciWorkflow = readFileSync(fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)), 'utf8');
const tier0Workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/tier0.yml', import.meta.url)), 'utf8');
const exportWorkflowPath = fileURLToPath(new URL('../.github/workflows/oss-export-gate.yml', import.meta.url));
const exportWorkflow = existsSync(exportWorkflowPath) ? readFileSync(exportWorkflowPath, 'utf8') : '';
const gitleaksAction = readFileSync(
  fileURLToPath(new URL('../.github/actions/install-gitleaks/action.yml', import.meta.url)),
  'utf8'
);

it('keeps the release workflow below the hard file cap', () => {
  expect(workflow.split('\n').length).toBeLessThanOrEqual(801);
});

it('builds the pinned scanner through its declared Go module path', () => {
  expect(gitleaksAction).toContain('github.com/zricethezav/gitleaks/v8@${SCANNER_COMMIT}');
  expect(gitleaksAction).not.toContain('github.com/gitleaks/gitleaks/v8@${SCANNER_COMMIT}');
});

describe('npm publish workflow lifecycle gate', () => {
  it('runs only after a GitHub Release is published', () => {
    expect(workflow).toContain('run-name: Publish ${{ github.event.release.tag_name || inputs.tag }}');
    expect(workflow).toMatch(/release:\s*\n\s+types:\s*\[published\]/);
    expect(workflow).not.toMatch(/push:\s*\n\s+tags:/);
    expect(workflow).not.toContain('softprops/action-gh-release');
    expect(workflow).toMatch(/validate:\s*\n\s+name: Validate release\s*\n\s+runs-on: ubuntu-latest/);
    // The operator dispatch entry is an event-delivery path ONLY: the
    // workflow still requires an already-PUBLISHED Release object —
    // resolved by tag, draft-rejected, re-validated before mutation.
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toContain('gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${DISPATCH_TAG}"');
    expect(workflow).toContain('release is a draft — publish it first');
    expect(workflow).toContain('node tools/release-state.js revalidate');
  });

  it('uses one protected transaction job for every secret read and registry mutation', () => {
    expect(workflow).toMatch(
      /release-transaction:\s*\n\s+name: Publish and reconcile release\s*\n\s+environment: public-release/
    );
    expect(workflow.match(/environment: public-release/g)).toHaveLength(1);
    const transaction = workflow.slice(workflow.indexOf('  release-transaction:'));
    const transactionHeader = transaction.slice(0, transaction.indexOf('    steps:'));
    expect(transaction).toContain('secrets.NPM_TOKEN');
    expect(transaction).toContain('secrets.BONKLM_RELEASE_DENY_TERMS');
    expect(transaction).toContain('packages: write');
    expect(transaction).toContain('id-token: write');
    expect(transactionHeader).not.toContain('GH_TOKEN:');
    expect(workflow.match(/run: node tools\/install-pinned-npm\.js/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/npm install --global npm@/);
    const transactionInstall = transaction.indexOf('pnpm install --frozen-lockfile --ignore-scripts');
    expect(transactionInstall).toBeGreaterThan(transaction.indexOf('Checkout validated commit'));
    expect(transactionInstall).toBeLessThan(transaction.indexOf('release-npm-cli.js preflight-access'));
  });

  it('scopes npm provenance permission to the protected transaction job', () => {
    const workflowPermissions = workflow.slice(workflow.indexOf('permissions:'), workflow.indexOf('jobs:'));
    expect(workflowPermissions).toContain('contents: read');
    expect(workflowPermissions).not.toContain('id-token: write');
    expect(workflow).toMatch(
      /release-transaction:\s*\n(?:.|\n)*?permissions:\s*\n\s+contents: read\s*\n\s+id-token: write/
    );
  });

  it('fails closed on shipped audit, license, and SBOM gates before publishing', () => {
    const auditIndex = workflow.indexOf('node scripts/supply-chain-audit.mjs "${ROOT_ARGS[@]}"');
    const licenseIndex = workflow.indexOf('node scripts/license-audit.mjs "${ROOT_ARGS[@]}"');
    const consumerIndex = workflow.indexOf('node tools/release-npm-cli.js preflight-consumer release/npm release/sbom');
    const sbomIndex = consumerIndex;
    const publishIndex = workflow.indexOf('node tools/release-npm-cli.js publish release/npm');

    expect(Math.min(auditIndex, licenseIndex, sbomIndex)).toBeGreaterThan(-1);
    expect(Math.max(auditIndex, licenseIndex, sbomIndex)).toBeLessThan(publishIndex);
    expect(consumerIndex).toBeGreaterThan(workflow.indexOf('node scripts/check-release-tarballs.js'));
    expect(consumerIndex).toBeLessThan(publishIndex);
    expect(workflow).toContain('node tools/release-npm-cli.js candidates "$SCOPE" "$VERSION"');
    expect(workflow).toContain('node tools/check-release-plan.js --assert-consumed "$SCOPE"');
    expect(workflow).toContain('node tools/release-npm-cli.js prepare release/npm "$SCOPE" "$VERSION"');
    expect(workflow).toContain('node scripts/check-release-tarballs.js');
    expect(workflow).toContain('node scripts/check-public-export.js');
    expect(workflow).toContain('gitleaks detect --source . --no-git');
    expect(workflow).toContain('BONKLM_TARBALL_DIR: release/npm');
    expect(workflow).toContain('BONKLM_RESTRICTED_TERMS: ${{ secrets.BONKLM_RELEASE_DENY_TERMS }}');
    expect(workflow).toContain('BONKLM_REQUIRE_RESTRICTED_TERMS: true');
    expect(workflow).not.toContain('tools/oss-export/');
    expect(workflow).not.toContain('pnpm exec changeset publish');
    expect(workflow).not.toContain('pnpm audit --audit-level=high || true');
    expect(workflow).not.toContain('node scripts/gen-sbom.mjs --root "$root"');
  });

  it('builds a fresh checkout before type and lint gates, including package type matrices', () => {
    const buildIndex = workflow.indexOf('pnpm run build');
    expect(buildIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeLessThan(workflow.indexOf('pnpm exec tsc --noEmit'));
    expect(buildIndex).toBeLessThan(workflow.indexOf('pnpm run test:types'));
    expect(buildIndex).toBeLessThan(workflow.indexOf('pnpm run lint'));
    // v20 line tested at its current LTS floor: eslint 10's
    // import-attribute syntax is unparseable on 20.4.0's V8.
    expect(workflow).toContain('node-version: [20, 22, 24]');
  });

  it('binds consumed Changesets validation to the pull request base commit', () => {
    const releasePlan = ciWorkflow.slice(ciWorkflow.indexOf('  release-plan:'), ciWorkflow.indexOf('  container:'));
    expect(releasePlan).toContain(
      'CHANGESET_BASE_REF: ${{ github.event.pull_request.base.sha || github.event.before }}'
    );
  });

  it('installs the pinned Changesets CLI before validating the consumed release plan', () => {
    const validate = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('  build:'));
    const installIndex = validate.indexOf('pnpm install --frozen-lockfile --ignore-scripts');
    const localMainIndex = validate.indexOf('git branch --force main origin/main');
    const planIndex = validate.indexOf('node tools/check-release-plan.js --assert-consumed "$SCOPE"');
    expect(validate).toContain('pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320');
    expect(validate).toContain('node-version: 24.19.0');
    expect(installIndex).toBeGreaterThan(-1);
    expect(localMainIndex).toBeGreaterThan(-1);
    expect(localMainIndex).toBeLessThan(validate.indexOf('- name: Setup pnpm'));
    expect(localMainIndex).toBeLessThan(planIndex);
    expect(installIndex).toBeLessThan(planIndex);
    expect(workflow.match(/git branch --force main origin\/main/g)).toHaveLength(2);
  });

  it('authenticates the npm scope before the first immutable registry write', () => {
    const whoamiIndex = workflow.indexOf('npm whoami');
    const scopeIndex = workflow.indexOf('npm access list packages "@blackunicorn"');
    const containerIndex = workflow.indexOf('Expose the signed exact container after npm exact versions verify');
    const publishIndex = workflow.indexOf('node tools/release-npm-cli.js publish release/npm');
    expect(whoamiIndex).toBeGreaterThan(-1);
    expect(workflow).not.toContain('npm access list packages "$NPM_USER"');
    expect(scopeIndex).toBeGreaterThan(whoamiIndex);
    expect(scopeIndex).toBeLessThan(containerIndex);
    expect(scopeIndex).toBeLessThan(publishIndex);
    expect(workflow).not.toContain('npm-auth-preflight:');
    expect(workflow).toContain('release-npm-cli.js preflight-access release/npm');
  });

  it('pins external actions and every mutating job to the validated commit', () => {
    const externalUses = [
      ...`${workflow}\n${recoveryWorkflow}\n${ciWorkflow}\n${tier0Workflow}\n${exportWorkflow}`.matchAll(
        /^\s*uses:\s+([^\s#]+)/gm
      )
    ]
      .map(match => match[1])
      .filter(value => !value.startsWith('./'));
    expect(externalUses.length).toBeGreaterThan(0);
    expect(externalUses.every(value => /@[0-9a-f]{40}$/.test(value))).toBe(true);
    if (exportWorkflow !== '') {
      expect(exportWorkflow).toMatch(/permissions:\s*\n\s+contents: read/);
      expect(exportWorkflow).toContain('persist-credentials: false');
      expect(exportWorkflow).not.toMatch(/pull_request:\s*\n\s+paths:/);
    }
    expect(workflow).toContain('sha: ${{ steps.release.outputs.sha }}');
    expect(workflow.match(/ref: \$\{\{ needs\.validate\.outputs\.sha \}\}/g)?.length).toBeGreaterThanOrEqual(3);
    expect(workflow).toContain('Assert release tag still resolves to the validated commit');
  });

  it('verifies the pinned Temporal test server before the integration suite executes it', () => {
    const verifyIndex = ciWorkflow.indexOf('Verify pinned Temporal test server');
    const integrationIndex = ciWorkflow.indexOf('Run TestWorkflowEnvironment integration suite');
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeLessThan(integrationIndex);
    expect(ciWorkflow).toContain('temporal-test-server_1.38.0_linux_amd64.tar.gz');
    expect(ciWorkflow).toContain('41df834fe8e1ac59619e13908f41b63e4d1054f37634a2f89033d8cf6af71b96');
    expect(ciWorkflow).toContain('daa58458d32f6254a901085c27ad1c19a64a4e171679ed08b5b92c298baba6ce');
    expect(ciWorkflow).not.toContain('Capture Temporal binary SHA-256');
  });

  it('enforces 100% line and branch coverage on the changed production diff', () => {
    expect(ciWorkflow).not.toContain('pnpm run test -- --coverage');
    const testJob = ciWorkflow.slice(ciWorkflow.indexOf('  test:'), ciWorkflow.indexOf('  uat:'));
    const scannerIndex = testJob.indexOf('uses: ./.github/actions/install-gitleaks');
    const coverageIndex = ciWorkflow.indexOf('pnpm exec vitest run --coverage');
    const diffIndex = ciWorkflow.indexOf('pnpm run check:diff-coverage');
    expect(scannerIndex).toBeGreaterThan(-1);
    expect(scannerIndex).toBeLessThan(testJob.indexOf('pnpm exec vitest run --coverage'));
    expect(coverageIndex).toBeGreaterThan(-1);
    expect(diffIndex).toBeGreaterThan(coverageIndex);
    expect(ciWorkflow).toContain(
      'DIFF_COVERAGE_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}'
    );
  });

  it('uses the shared release-scope classifier instead of a divergent shell regex', () => {
    expect(workflow).toContain('classify-body "$(cat "$RELEASE_BODY_FILE")")"');
    expect(workflow).not.toContain('Release-Scope: (family|@blackunicorn/[a-z0-9-]+)');
  });

  it('verifies npm exact versions before exposing the signed exact container and has no mutable container channels', () => {
    const stageIndex = workflow.indexOf('Push only a private opaque staging reference');
    const signIndex = workflow.indexOf('Sign and verify the staged image digest');
    const exactIndex = workflow.indexOf('Expose the signed exact container after npm exact versions verify');
    const publishIndex = workflow.indexOf('Publish immutable npm versions under an opaque staging tag');
    const verifyIndex = workflow.indexOf('Verify exact npm bytes and source-bound provenance');
    const npmPromoteIndex = workflow.indexOf('Promote and reconcile the public npm channel');
    expect(stageIndex).toBeGreaterThan(-1);
    expect(stageIndex).toBeLessThan(signIndex);
    expect(signIndex).toBeLessThan(publishIndex);
    expect(publishIndex).toBeLessThan(verifyIndex);
    expect(verifyIndex).toBeLessThan(exactIndex);
    expect(publishIndex).toBeLessThan(npmPromoteIndex);
    expect(exactIndex).toBeLessThan(npmPromoteIndex);
    expect(workflow).toMatch(/release-transaction:[\s\S]*?needs: \[validate, build, artifact-preflight\]/);
    expect(workflow).not.toContain('container-promote:');
    expect(workflow).not.toContain('${IMAGE_NAME}:${CHANNEL}');
    expect(workflow).toContain('tonistiigi/binfmt:qemu-v10.2.3@sha256:400a4873');
    expect(workflow).toContain('version: v0.36.1');
    expect(workflow).toContain('moby/buildkit:v0.32.2@sha256:28a89871');
    expect(workflow).toContain('node-version: 24.19.0');
  });

  it('uses an explicit release scope and separates family/container from Tier-B publication', () => {
    expect(workflow).toContain('classify-body "$(cat "$RELEASE_BODY_FILE")")"');
    expect(workflow).toContain("IFS=$'\\t' read -r SCOPE KIND PREFIX");
    expect(workflow).toContain("if: needs.validate.outputs.kind == 'family'");
    expect(workflow).toContain("if: needs.validate.outputs.kind == 'family'");
    expect(workflow).not.toContain('container-stage:');
    expect(workflow).toContain('node tools/release-npm-cli.js preflight-consumer release/npm release/sbom');
    expect(workflow).toContain('node scripts/check-sbom-licenses.mjs "${{ needs.validate.outputs.version }}"');
    expect(workflow).toContain('bonklm-server-amd64.sbom.json bonklm-server-amd64.inventory.json');
    expect(workflow).toContain('bonklm-server-arm64.sbom.json bonklm-server-arm64.inventory.json');
    expect(workflow).toContain('SOURCE_DATE_EPOCH="$(git show -s --format=%ct HEAD)"');
    expect(workflow).toContain('node scripts/license-audit.mjs "${ROOT_ARGS[@]}"');
    expect(workflow).toContain('node scripts/supply-chain-audit.mjs "${ROOT_ARGS[@]}"');
  });

  it('validates prerelease mode and reconciles npm channel state from retained bytes', () => {
    expect(workflow).toContain('node tools/release-version.js "$VERSION" .changeset/pre.json');
    expect(workflow).toContain('node tools/release-version.js "$VERSION")');
    expect(workflow).toContain('node tools/release-npm-cli.js verify-channel release/npm "$CHANNEL"');
    expect(workflow.match(/Download verified release artifacts/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('serializes registry writes and requires the GHCR visibility bootstrap before npm', () => {
    expect(workflow).toMatch(
      /concurrency:\s*\n\s+group: bonklm-registry-publish\s*\n\s+cancel-in-progress: false\s*\n\s+queue: max/
    );
    expect(workflow).toContain('assert-package BlackUnicornSecurity bonklm-server public');
    expect(workflow).toContain('assert-package BlackUnicornSecurity bonklm-server-staging private allow-missing');
    expect(workflow).toContain('assert-no-mutable-tags BlackUnicornSecurity bonklm-server');
    expect(workflow).toContain('Expose the signed exact container after npm exact versions verify');
    expect(workflow).toContain('EFFECTIVE_DIGEST');
    expect(workflow.match(/cosign verify --certificate-identity/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('cryptographically binds npm and container provenance to the release identity', () => {
    expect(workflow).toContain('Verify exact npm bytes and source-bound provenance');
    expect(workflow).toContain('verify-provenance release/npm');
    expect(workflow).toContain(
      '--certificate-identity "https://github.com/BlackUnicornSecurity/bonklm/.github/workflows/publish.yml@refs/tags/v${RELEASE_VERSION}"'
    );
    expect(workflow).toContain('refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG');
    expect(workflow.match(/node tools\/release-state\.js revalidate/g)?.length).toBeGreaterThanOrEqual(4);
    expect(workflow).toMatch(
      /Promote and reconcile the public npm channel[\s\S]*promote release\/npm "\$CHANNEL" release\/npm-recovery\.json[\s\S]*verify-channel release\/npm "\$CHANNEL"[\s\S]*verify-provenance release\/npm "\$CHANNEL"/
    );
    expect(workflow).toContain('RELEASE_SCOPE: ${{ needs.validate.outputs.scope }}');
  });

  it('retains npm recovery state and cleans every opaque staging reference', () => {
    expect(workflow).toContain('snapshot release/npm "$CHANNEL" release/npm-recovery.json');
    expect(workflow).toContain(
      'cosign sign-blob --yes --bundle release/npm-recovery.sigstore.json release/npm-recovery.json'
    );
    expect(workflow).toContain('promote release/npm "$CHANNEL" release/npm-recovery.json');
    expect(workflow).toContain('npm-recovery');
    expect(workflow).toContain("if: failure() && steps.snapshot.outcome == 'success'");
    expect(workflow).toContain('restore release/npm release/npm-recovery.json');
    expect(workflow).toContain('cleanup-staging release/npm "$STAGING_TAG"');
    expect(workflow).toContain('release-container.js cleanup-staging');
    expect(workflow).toContain('STAGING_IMAGE: ghcr.io/blackunicornsecurity/bonklm-server-staging');
  });
});

describe('failed release recovery workflow', () => {
  it('runs independently after an unsuccessful Publish workflow', () => {
    expect(recoveryWorkflow).toMatch(/workflow_run:\s*\n\s+workflows: \[Publish\]\s*\n\s+types: \[completed\]/);
    expect(recoveryWorkflow).toContain("github.event.workflow_run.conclusion != 'success'");
    expect(recoveryWorkflow).toMatch(
      /recover:\s*\n\s+name: Reconcile failed release\s*\n\s+environment: public-release-recovery/
    );
    expect(recoveryWorkflow).not.toContain('id-token: write');
    expect(recoveryWorkflow.match(/run: node tools\/install-pinned-npm\.js/g)).toHaveLength(1);
    expect(recoveryWorkflow).not.toMatch(/npm install --global npm@/);
    const recoveryInstall = recoveryWorkflow.indexOf('pnpm install --frozen-lockfile --ignore-scripts');
    expect(recoveryInstall).toBeGreaterThan(recoveryWorkflow.indexOf('Validate the failed workflow identity'));
    expect(recoveryInstall).toBeLessThan(recoveryWorkflow.indexOf('release-npm-cli.js verify-local'));
    expect(recoveryWorkflow).toMatch(
      /concurrency:\s*\n\s+group: bonklm-registry-publish\s*\n\s+cancel-in-progress: false\s*\n\s+queue: max/
    );
    expect(recoveryWorkflow).toMatch(
      /recover:[\s\S]*?needs: mark-failed\s*\n\s+if: always\(\) && github\.event\.workflow_run\.conclusion != 'success'/
    );
  });

  it('uses the failed run artifacts to restore channels and clean its staging references', () => {
    expect(recoveryWorkflow).toContain('run-id: ${{ github.event.workflow_run.id }}');
    expect(recoveryWorkflow).toContain('pattern: bonklm-*-release-artifacts');
    expect(recoveryWorkflow).toContain('pattern: bonklm-*-npm-recovery');
    expect(recoveryWorkflow).toContain(
      'names-at-ref "$SCOPE" "$FAILED_SHA" "$RUNNER_TEMP/recovery-package-names.json"'
    );
    const retainedContext = recoveryWorkflow.slice(
      recoveryWorkflow.indexOf('Validate the retained release context'),
      recoveryWorkflow.indexOf('Verify the retained bundle against trusted recovery policy')
    );
    expect(retainedContext).toContain('GH_TOKEN: ${{ github.token }}');
    expect(recoveryWorkflow).toContain('release-state.js resolve-published "$GITHUB_REPOSITORY" "$SCOPE" "$TAG"');
    expect(recoveryWorkflow).toContain('test "$FAILED_RUN_TITLE" = "Publish $TAG"');
    expect(recoveryWorkflow).toContain('RELEASE_PACKAGE_NAMES_FILE=$RUNNER_TEMP/recovery-package-names.json');
    expect(recoveryWorkflow).toContain('verify-local release/npm');
    expect(recoveryWorkflow).toContain('cosign verify-blob --bundle release/recovery/npm-recovery.sigstore.json');
    expect(recoveryWorkflow).toContain("steps.recovery-signature.outcome == 'success'");
    expect(recoveryWorkflow).toContain('restore release/npm release/recovery/npm-recovery.json');
    expect(recoveryWorkflow).toContain('cleanup-staging release/npm "$STAGING_TAG"');
    expect(recoveryWorkflow).toContain('release-container.js cleanup-staging');
    expect(recoveryWorkflow).toContain('sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6');
    expect(recoveryWorkflow).toContain('state=failure -f context=bonklm/release-ready');
    expect(recoveryWorkflow).toContain(
      'STAGING_TAG: staging-${{ github.event.workflow_run.id }}-${{ github.event.workflow_run.run_attempt }}'
    );
  });
});

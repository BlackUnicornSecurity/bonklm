function sha512Hex(integrityValue) {
  const match = /^sha512-(.+)$/.exec(integrityValue);
  if (match === null) throw new Error('Registry integrity is not SHA-512');
  return Buffer.from(match[1], 'base64').toString('hex');
}

function packagePurl(name, version) {
  return `pkg:npm/${encodeURIComponent(name).replace('%2F', '/')}@${version}`;
}

export function validateAttestationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error('Registry attestation URL is invalid', { cause: error });
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'registry.npmjs.org' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    !url.pathname.startsWith('/-/npm/v1/attestations/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Registry attestation URL is not an approved npm HTTPS endpoint');
  }
  return url.href;
}

export function slsaBundle(document, pkg) {
  const slsa = document?.attestations?.find(
    attestation => attestation.predicateType === 'https://slsa.dev/provenance/v1'
  );
  if (slsa === undefined) throw new Error(`SLSA provenance missing: ${pkg.name}@${pkg.version}`);
  if (slsa.bundle === null || typeof slsa.bundle !== 'object' || Array.isArray(slsa.bundle)) {
    throw new Error(`SLSA provenance bundle is invalid: ${pkg.name}@${pkg.version}`);
  }
  return slsa.bundle;
}

export function verifyAttestationDocument(document, pkg, source) {
  if (!/^[0-9a-f]{40}$/.test(source.sha ?? '')) {
    throw new Error(`Expected release SHA is invalid: ${pkg.name}@${pkg.version}`);
  }
  const bundle = slsaBundle(document, pkg);
  let statement;
  try {
    statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  } catch (error) {
    throw new Error(`SLSA provenance payload is invalid: ${pkg.name}@${pkg.version}`, { cause: error });
  }
  const subject = statement.subject?.find(item => item.name === packagePurl(pkg.name, pkg.version));
  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
  const dependencies = statement.predicate?.buildDefinition?.resolvedDependencies;
  const dependency = Array.isArray(dependencies)
    ? dependencies.find(
        item => item?.uri === `git+https://github.com/${source.repository}@${source.ref}` && item?.digest?.gitCommit
      )
    : null;
  const commit = dependency?.digest.gitCommit;
  if (
    subject?.digest?.sha512 !== sha512Hex(pkg.integrity) ||
    workflow?.repository !== `https://github.com/${source.repository}` ||
    workflow?.path !== source.workflow ||
    workflow?.ref !== source.ref ||
    statement.predicate?.runDetails?.builder?.id !== 'https://github.com/actions/runner/github-hosted' ||
    commit !== source.sha
  ) {
    throw new Error(`SLSA provenance identity mismatch: ${pkg.name}@${pkg.version}`);
  }
}

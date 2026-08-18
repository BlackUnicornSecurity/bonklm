const TIER_B_SCOPE_PATTERN = /^@blackunicorn\/([a-z0-9-]+)$/;
export const FAMILY_SIZE = 52;

export function classifyReleaseScope(scope) {
  if (scope === 'family') return { kind: 'family', prefix: 'v', scope };
  const match = TIER_B_SCOPE_PATTERN.exec(scope);
  if (match === null) throw new Error('Release scope is not family or a release-compatible Tier-B package name');
  return { kind: 'tool', prefix: `${match[1]}-v`, scope };
}

export function isTierBPackageName(name) {
  return typeof name === 'string' && TIER_B_SCOPE_PATTERN.test(name);
}

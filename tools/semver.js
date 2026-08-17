const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemver(version) {
  if (typeof version !== 'string') return null;
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;
  const prerelease = match[4]?.split('.') ?? null;
  if (prerelease?.some(identifier => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    return null;
  }
  return { core: match.slice(1, 4), prerelease };
}

export function isValidSemver(version) {
  return parseSemver(version) !== null;
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  return left === right ? 0 : left < right ? -1 : 1;
}

function comparePrereleaseIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return compareNumericIdentifiers(left, right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function compareSemver(left, right) {
  const leftParsed = parseSemver(left);
  const rightParsed = parseSemver(right);
  if (leftParsed === null || rightParsed === null) throw new TypeError('compareSemver requires valid SemVer values');
  for (let index = 0; index < 3; index += 1) {
    const comparison = compareNumericIdentifiers(leftParsed.core[index], rightParsed.core[index]);
    if (comparison !== 0) return comparison;
  }
  if (leftParsed.prerelease === null || rightParsed.prerelease === null) {
    if (leftParsed.prerelease === rightParsed.prerelease) return 0;
    return leftParsed.prerelease === null ? 1 : -1;
  }
  const identifierCount = Math.min(leftParsed.prerelease.length, rightParsed.prerelease.length);
  for (let index = 0; index < identifierCount; index += 1) {
    const comparison = comparePrereleaseIdentifiers(leftParsed.prerelease[index], rightParsed.prerelease[index]);
    if (comparison !== 0) return comparison;
  }
  return leftParsed.prerelease.length - rightParsed.prerelease.length;
}

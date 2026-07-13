/** Named version axes that advance independently. */
import packageJson from "../package.json";

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

declare const SDK_VERSION_BRAND: unique symbol;
declare const NODE_ASSET_VERSION: unique symbol;
declare const WORKSPACE_DOCUMENT_VERSION: unique symbol;

export type SDKVersion = string & { readonly [SDK_VERSION_BRAND]: true };
export type NodeAssetVersion = string & { readonly [NODE_ASSET_VERSION]: true };
export type WorkspaceDocumentVersion = number & {
  readonly [WORKSPACE_DOCUMENT_VERSION]: true;
};

export function sdkVersion(value: string): SDKVersion {
  return value as SDKVersion;
}

export function nodeAssetVersion(value: string): NodeAssetVersion {
  return value as NodeAssetVersion;
}

export function workspaceDocumentVersion(value: number): WorkspaceDocumentVersion {
  return value as WorkspaceDocumentVersion;
}

export const SDK_VERSION = sdkVersion(packageJson.version);

export function sdkMajor(version: SDKVersion): string {
  return version.split(".")[0] ?? "";
}

type ParsedVersion = readonly [number, number, number, readonly (number | string)[]];

function parseVersion(value: string): ParsedVersion | undefined {
  const match = SEMVER_RE.exec(value);
  if (!match) return undefined;
  const prerelease = (match[4] ?? "")
    .split(".")
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return [Number(match[1]), Number(match[2]), Number(match[3]), prerelease];
}

export function isSemanticVersion(value: string): boolean {
  return parseVersion(value) !== undefined;
}

export function compareSemanticVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return left.localeCompare(right);
  for (const index of [0, 1, 2] as const) {
    const difference = a[index] - b[index];
    if (difference) return difference;
  }
  const aPre = a[3];
  const bPre = b[3];
  if (aPre.length === 0 || bPre.length === 0) return aPre.length === bPre.length ? 0 : aPre.length === 0 ? 1 : -1;
  for (let index = 0; index < Math.max(aPre.length, bPre.length); index += 1) {
    const av = aPre[index];
    const bv = bPre[index];
    if (av === undefined || bv === undefined) return av === bv ? 0 : av === undefined ? -1 : 1;
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    if (typeof av === "number") return -1;
    if (typeof bv === "number") return 1;
    return av.localeCompare(bv);
  }
  return 0;
}

/**
 * Test one concrete semantic version against the SDK's supported range syntax.
 *
 * Supported ranges are exact/partial versions, comparison sets, `^`, `~`,
 * wildcard components, hyphen ranges, and `||` alternatives.
 */
export function isVersionCompatible(version: string, range: string): boolean {
  if (!parseVersion(version)) return false;
  return range.split("||").some((alternative) => {
    const trimmed = alternative.trim();
    if (trimmed === "*" || trimmed.toLowerCase() === "latest") return true;
    if (!trimmed) return false;
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed);
    if (hyphen) return testComparator(version, `>=${hyphen[1]}`) && testComparator(version, `<=${hyphen[2]}`);
    return trimmed.split(/\s+/).every((comparator) => testComparator(version, comparator));
  });
}

function testComparator(version: string, comparator: string): boolean {
  const match = /^(\^|~|>=|<=|>|<|=)?[v=]?(.+)$/.exec(comparator);
  if (!match) return false;
  const operator = match[1] ?? "=";
  const target = match[2];
  if (/[*xX]/.test(target)) {
    const actual = parseVersion(version);
    if (!actual) return false;
    const wanted = target.split(".");
    return wanted.every(
      (part, index) => index > 2 || /^(?:\*|x)$/i.test(part) || (/^\d+$/.test(part) && Number(part) === actual[index]),
    );
  }
  const parsedTarget = parseVersion(normalizePartialVersion(target));
  if (!parsedTarget) return false;
  const normalizedTarget = formatVersion(parsedTarget);
  const difference = compareSemanticVersions(version, normalizedTarget);
  if (operator === "^") {
    const upper: ParsedVersion =
      parsedTarget[0] > 0
        ? [parsedTarget[0] + 1, 0, 0, []]
        : parsedTarget[1] > 0
          ? [0, parsedTarget[1] + 1, 0, []]
          : [0, 0, parsedTarget[2] + 1, []];
    return difference >= 0 && compareSemanticVersions(version, formatVersion(upper)) < 0;
  }
  if (operator === "~") {
    const upper: ParsedVersion = [parsedTarget[0], parsedTarget[1] + 1, 0, []];
    return difference >= 0 && compareSemanticVersions(version, formatVersion(upper)) < 0;
  }
  if (operator === ">=") return difference >= 0;
  if (operator === "<=") return difference <= 0;
  if (operator === ">") return difference > 0;
  if (operator === "<") return difference < 0;
  return difference === 0;
}

function normalizePartialVersion(value: string): string {
  const [core, suffix] = value.split(/(?=-|\+)/, 2);
  const parts = core.split(".");
  while (parts.length < 3) parts.push("0");
  return `${parts.join(".")}${suffix ?? ""}`;
}

function formatVersion(version: ParsedVersion): string {
  const prerelease = version[3].length > 0 ? `-${version[3].join(".")}` : "";
  return `${version[0]}.${version[1]}.${version[2]}${prerelease}`;
}

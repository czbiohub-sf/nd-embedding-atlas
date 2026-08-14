/**
 * Joins a root-relative pathname onto `site.baseUrl`, preserving the
 * deployment subpath.
 *
 * `new URL("/install", "https://host/nd-embedding-atlas/")` resolves to
 * `https://host/install`, because a leading slash resets the pathname. Several
 * Fumapress plugins build absolute URLs that way, so on a GitHub Pages project
 * site they advertise URLs at the organization root. Resolving the reference
 * *without* the leading slash against a trailing-slash base keeps the subpath.
 */
export function absoluteUrl(
  pathname: string,
  baseUrl: string | undefined,
): string {
  if (!baseUrl) return pathname;

  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ""), base).href;
}

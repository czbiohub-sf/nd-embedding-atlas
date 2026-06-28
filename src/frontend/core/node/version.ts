/**
 * Plugin host-API version (CAPABILITY-CONTRACT / PLUGIN-ARCHITECTURE).
 *
 * The single semver string a plugin author targets via `NodeMeta.sdkVersion`.
 * The registry gates a descriptor's MAJOR against this at registration, so a
 * plugin built for an incompatible host is rejected rather than mis-loaded.
 *
 * Lives in its own module so `registry.ts` can import it without pulling in the
 * full `sdk.ts` author barrel (avoids an import cycle).
 *
 * NB: distinct from the app version (`src/cli/version.ts`) — this is the
 * extension-API contract version, which we bump independently as the host
 * surface evolves. Neither Pi nor oh-my-pi version their extension API; we lead.
 */
export const SDK_VERSION = "0.1.0";

/** Major component of a semver string (the compat axis). */
export function sdkMajor(version: string): string {
  return version.split(".")[0];
}

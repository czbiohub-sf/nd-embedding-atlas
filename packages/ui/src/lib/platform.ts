/**
 * Detected once at module load. Used to pick platform-appropriate keyboard
 * shortcuts (⌘ on macOS, Ctrl on Windows/Linux). The Bun-served app
 * is a SPA: `navigator` is always defined at component-evaluation time.
 */
const IS_MAC =
  typeof navigator !== "undefined" &&
  // navigator.platform is deprecated but still the most reliable cross-browser
  // signal for "is this a Mac/iOS-style device". userAgentData is Chromium-only.
  /Mac|iPhone|iPad/.test(navigator.platform);

/** Glyph for the primary modifier key on the current platform. */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

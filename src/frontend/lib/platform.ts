/**
 * Detected once at module load. Used to pick platform-appropriate keyboard
 * shortcuts (⌘ on macOS, Ctrl on Windows/Linux). The Bun-served dashboard
 * is a SPA — `navigator` is always defined at component-evaluation time.
 */
export const IS_MAC =
  typeof navigator !== "undefined" &&
  // navigator.platform is deprecated but still the most reliable cross-browser
  // signal for "is this a Mac/iOS-style device". userAgentData is Chromium-only.
  /Mac|iPhone|iPad/.test(navigator.platform);

/** Glyph for the primary modifier key on the current platform. */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

/** Glyph for the alt/option key on the current platform. */
export const ALT_KEY = IS_MAC ? "⌥" : "Alt";

/** Glyph for the shift key (same on all platforms but exported for symmetry). */
export const SHIFT_KEY = "⇧";

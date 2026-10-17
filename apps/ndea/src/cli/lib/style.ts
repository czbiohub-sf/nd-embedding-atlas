/**
 * Terminal styling for every ndea command, on @crustjs/style. The palette
 * follows the web app's Lab HUD look: one periwinkle accent, dim labels,
 * green ok, amber warn, red error. Colors follow `NO_COLOR`, `FORCE_COLOR`,
 * `--no-color`, and whether stdout is a terminal; bold, dim, and links are
 * dropped with them, so `--no-color` output carries no escape codes at all.
 */

import { defineExtension, defineExtensionId } from "@crustjs/core";
import { spinner } from "@crustjs/progress";
import { bold, dim, fg, link, style } from "@crustjs/style";
import type { StyleFn } from "@crustjs/style";

const color =
  (hex: string): StyleFn =>
  (text) =>
    fg(text, hex);
/** @crustjs/style keeps modifiers under NO_COLOR; ndea treats "no color" as plain text. */
const modifier =
  (paint: StyleFn): StyleFn =>
  (text) =>
    style.colorsEnabled ? paint(text) : text;

export const accent = color("#9272fd"); // --brand-periwinkle-400
const green = color("#00bc7d"); // --success-hue
const amber = color("#f59e0b"); // --warning-hue
const red = color("#e7000b"); // --danger-hue
export const heading = modifier(bold);
export const label = modifier(dim);

export const ok = (text: string): string => `${green("✓")} ${text}`;
export const warn = (text: string): string => `${amber("!")} ${text}`;
export const fail = (text: string): string => `${red("✗")} ${text}`;

export const num = (value: number): string => value.toLocaleString("en-US");
export const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
/** An accented URL, clickable (OSC 8) in terminals that support it. */
export const url = (href: string): string => (style.colorsEnabled ? link(accent(href), href) : href);

/**
 * Run `work` behind a spinner on stdout, beside the rest of the output. The
 * final line is `✓ <last message>` (or `✗` when `work` throws); a non-TTY
 * stdout (pipes, CI, agents) gets only that line, with no animation.
 */
export function task<T>(message: string, work: (update: (message: string) => void) => Promise<T>): Promise<T> {
  return spinner({
    message,
    sink: process.stdout,
    theme: {
      spinner: (frame) => `  ${accent(frame)}`,
      message: (text) => text,
      success: (symbol) => `  ${green(symbol)}`,
      error: (symbol) => `  ${red(symbol)}`,
    },
    task: ({ updateMessage }) => work(updateMessage),
  });
}

/** A failure whose message is already machine-readable (a server's JSON body): rendered verbatim. */
export class PlainError extends Error {}

/**
 * One rendering for every failure: `✗ first line` then dimmed detail lines.
 * Registered after `didYouMean()`, which claims unknown commands first;
 * cancellation (`AbortError`) stays silent with exit 130.
 */
export const errors = defineExtension(defineExtensionId("ndea:errors")).onError((error, { stderr }) => {
  if (error instanceof Error && error.name === "AbortError") return;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof PlainError) {
    stderr(message);
    return true;
  }
  const [first, ...rest] = message.split("\n");
  stderr(fail(first));
  for (const line of rest) stderr(label(line));
  return true;
});

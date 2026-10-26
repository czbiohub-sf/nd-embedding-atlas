import type { ComponentHost } from "@ndea/sdk";

import type { TextConfig } from "./definition";

const STYLE = {
  heading: "font-medium text-foreground text-lg",
  body: "text-foreground text-ui",
  muted: "text-text-muted text-ui",
} as const;

/** `text` arrives resolved: the host evaluates its expressions against coordination state. */
export function TextBody({ host }: { host: ComponentHost<TextConfig> }) {
  const { text, variant } = host.config;
  return (
    <div className={`min-w-0 flex-1 px-2.5 py-1 ${STYLE[variant] ?? STYLE.body}`}>
      {typeof text === "string" ? text : ""}
    </div>
  );
}

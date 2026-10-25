import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design type scale (styles.css @theme) adds non-t-shirt font sizes; without
// this, tailwind-merge reads `text-ui` as a color and drops `text-foreground`.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["ui-sm", "ui", "ui-lg", "metric"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Convert an array of hex color strings to normalized RGBA tuples for the GPU.
 *  Supports 6-digit (#RRGGBB) and 8-digit (#RRGGBBAA) hex strings. */
export function hexToRgbPalette(hexColors: string[]): readonly (readonly [number, number, number, number])[] {
  return hexColors.map((hex) => {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a] as const;
  });
}

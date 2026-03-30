/** Convert an array of hex color strings to normalized RGB tuples for the GPU. */
export function hexToRgbPalette(hexColors: string[]): readonly (readonly [number, number, number])[] {
  return hexColors.map((hex) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ] as const;
  });
}

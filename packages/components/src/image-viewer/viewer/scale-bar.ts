/** Symbols for OME-Zarr (UDUNITS) length units; others print as declared. Undeclared = micrometer. */
const UNIT_SYMBOLS: Record<string, string> = {
  micrometer: "µm",
  nanometer: "nm",
  millimeter: "mm",
  centimeter: "cm",
  meter: "m",
  angstrom: "Å",
};

export const unitSymbol = (unit?: string) => (unit ? (UNIT_SYMBOLS[unit] ?? unit) : "µm");

/** Largest 1/2/5 × 10^n not above `max`. */
export function roundLength(max: number): number {
  const pow = 10 ** Math.floor(Math.log10(max));
  return [5, 2, 1].map((m) => m * pow).find((v) => v <= max) ?? pow;
}

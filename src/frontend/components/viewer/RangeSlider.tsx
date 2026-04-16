interface Props {
    min: number;
    max: number;
    value: [number, number];
    onChange: (range: [number, number]) => void;
}

/** Dual-thumb range slider for selecting a Z sub-range. */
export function ZRangeSlider({ min, max, value, onChange }: Props) {
    const [lo, hi] = value;

    return (
        <div className="relative flex flex-1 items-center">
            <input
                type="range"
                min={min}
                max={max}
                value={lo}
                onChange={(e) => {
                    const v = Math.min(Number(e.target.value), hi - 1);
                    onChange([v, hi]);
                }}
                className="absolute h-1 w-full accent-accent-cyan"
                style={{ zIndex: lo > max - 2 ? 5 : 3 }}
                aria-label="Z range minimum"
            />
            <input
                type="range"
                min={min}
                max={max}
                value={hi}
                onChange={(e) => {
                    const v = Math.max(Number(e.target.value), lo + 1);
                    onChange([lo, v]);
                }}
                className="absolute h-1 w-full accent-accent-cyan"
                style={{ zIndex: 4 }}
                aria-label="Z range maximum"
            />
        </div>
    );
}

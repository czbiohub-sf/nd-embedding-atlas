import { Slider } from "@uwdata/mosaic-inputs";
import { useEffect, useRef } from "react";
import { useDashboard } from "../../hooks/useDashboard";

export function TimeSlider() {
    const { meta } = useDashboard();
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // The Slider JSDoc accepts Param | Selection but the TS types only declare Param.
        // At runtime this works — Slider checks isSelection(as) internally.
        const instance = new Slider({
            from: meta.table,
            column: "t",
            // biome-ignore lint: Slider accepts Selection at runtime despite Param-only types
            as: meta.brushSelection as any,
            select: "interval",
            label: "T",
            step: 1,
        });

        meta.coordinator.connect(instance);
        containerRef.current?.replaceChildren(instance.element);

        return () => {
            meta.coordinator.disconnect(instance);
            containerRef.current?.replaceChildren();
        };
    }, [meta.coordinator, meta.brushSelection, meta.table]);

    return <div ref={containerRef} className="time-slider flex items-center" />;
}

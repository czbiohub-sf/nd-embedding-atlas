import type { OverlayProxy } from "embedding-atlas/react";
import type { TrajectoryFrame } from "../../types";

export interface TrajectoryOverlayProps {
    proxy: OverlayProxy;
    points: TrajectoryFrame[];
    categoryColors?: string[] | null;
    activeIndex?: number | null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_COLOR = "#22d3ee";
const DEFAULT_ACTIVE_COLOR = "#ffffff";

/**
 * Plain JS class implementing embedding-atlas CustomComponent interface.
 * Renders an SVG polyline for a cell's trajectory across time frames.
 */
export class TrajectoryOverlay {
    private svg: SVGSVGElement;

    constructor(node: HTMLDivElement, props: TrajectoryOverlayProps) {
        this.svg = document.createElementNS(SVG_NS, "svg");
        this.svg.style.pointerEvents = "none";
        this.svg.style.position = "absolute";
        this.svg.style.top = "0";
        this.svg.style.left = "0";
        node.appendChild(this.svg);
        this.render(props);
    }

    update(props: TrajectoryOverlayProps) {
        this.render(props);
    }

    private render(props: TrajectoryOverlayProps) {
        const { proxy, points, categoryColors, activeIndex } = props;
        const svg = this.svg;

        svg.setAttribute("width", String(proxy.width));
        svg.setAttribute("height", String(proxy.height));
        svg.innerHTML = "";

        if (points.length === 0) return;

        const g = document.createElementNS(SVG_NS, "g");

        // Line segments
        for (let i = 1; i < points.length; i++) {
            const p1 = proxy.location(points[i - 1].emb_x, points[i - 1].emb_y);
            const p2 = proxy.location(points[i].emb_x, points[i].emb_y);
            const color = this.pointColor(points[i], categoryColors);

            const line = document.createElementNS(SVG_NS, "line");
            line.setAttribute("x1", String(p1.x));
            line.setAttribute("y1", String(p1.y));
            line.setAttribute("x2", String(p2.x));
            line.setAttribute("y2", String(p2.y));
            line.setAttribute("stroke", color);
            line.setAttribute("stroke-width", "2");
            line.setAttribute("stroke-opacity", "0.7");
            g.appendChild(line);
        }

        // Circles at each time point
        for (let i = 0; i < points.length; i++) {
            const loc = proxy.location(points[i].emb_x, points[i].emb_y);
            const isActive = activeIndex != null && i === activeIndex;
            const color = this.pointColor(points[i], categoryColors);

            const circle = document.createElementNS(SVG_NS, "circle");
            circle.setAttribute("cx", String(loc.x));
            circle.setAttribute("cy", String(loc.y));
            circle.setAttribute("r", isActive ? "6" : "3");
            circle.setAttribute("fill", isActive ? DEFAULT_ACTIVE_COLOR : color);
            circle.setAttribute("stroke", isActive ? color : "none");
            circle.setAttribute("stroke-width", isActive ? "2" : "0");
            g.appendChild(circle);
        }

        // Start/end markers
        if (points.length >= 2) {
            const start = proxy.location(points[0].emb_x, points[0].emb_y);
            const end = proxy.location(points[points.length - 1].emb_x, points[points.length - 1].emb_y);

            const startMarker = document.createElementNS(SVG_NS, "rect");
            startMarker.setAttribute("x", String(start.x - 4));
            startMarker.setAttribute("y", String(start.y - 4));
            startMarker.setAttribute("width", "8");
            startMarker.setAttribute("height", "8");
            startMarker.setAttribute("transform", `rotate(45 ${start.x} ${start.y})`);
            startMarker.setAttribute("fill", this.pointColor(points[0], categoryColors));
            startMarker.setAttribute("stroke", "#fff");
            startMarker.setAttribute("stroke-width", "1");
            g.appendChild(startMarker);

            const endMarker = document.createElementNS(SVG_NS, "circle");
            endMarker.setAttribute("cx", String(end.x));
            endMarker.setAttribute("cy", String(end.y));
            endMarker.setAttribute("r", "5");
            endMarker.setAttribute("fill", "none");
            endMarker.setAttribute("stroke", this.pointColor(points[points.length - 1], categoryColors));
            endMarker.setAttribute("stroke-width", "2.5");
            g.appendChild(endMarker);
        }

        svg.appendChild(g);
    }

    private pointColor(point: TrajectoryFrame, categoryColors?: string[] | null): string {
        if (categoryColors && point.category != null && point.category < categoryColors.length) {
            return categoryColors[point.category];
        }
        return DEFAULT_COLOR;
    }

    destroy() {
        this.svg.remove();
    }
}

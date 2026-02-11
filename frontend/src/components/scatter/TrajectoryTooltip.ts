import type { DataPoint } from "embedding-atlas/react";

export interface TrajectoryTooltipProps {
    tooltip: DataPoint;
    onShowTrajectory: (trackId: number, fovName: string, clickedT?: number) => void;
}

/**
 * Plain JS class implementing embedding-atlas CustomComponent interface.
 * Renders a tooltip card with cell fields and a "Show Trajectory" button.
 *
 * Follows the same pattern as embedding-atlas's Tooltip.svelte + Nearest Neighbors button.
 */
export class TrajectoryTooltip {
    private container: HTMLDivElement;

    constructor(node: HTMLDivElement, props: TrajectoryTooltipProps) {
        this.container = document.createElement("div");
        this.container.className = "trajectory-tooltip";
        node.appendChild(this.container);
        this.render(props);
    }

    update(props: TrajectoryTooltipProps) {
        this.render(props);
    }

    private render(props: TrajectoryTooltipProps) {
        const { tooltip, onShowTrajectory } = props;
        const fields = tooltip.fields ?? {};

        const el = this.container;
        el.innerHTML = "";

        // Field pills
        const pillsDiv = document.createElement("div");
        pillsDiv.className = "trajectory-tooltip__pills";

        const displayFields = ["track_id", "fov_name", "t", "infection_status"];
        for (const key of displayFields) {
            if (fields[key] == null) continue;
            const pill = document.createElement("span");
            pill.className = "trajectory-tooltip__pill";
            pill.innerHTML = `<span class="trajectory-tooltip__pill-key">${key}</span> ${fields[key]}`;
            pillsDiv.appendChild(pill);
        }

        // Show remaining fields not in the display list
        for (const [key, value] of Object.entries(fields)) {
            if (displayFields.includes(key) || value == null) continue;
            const pill = document.createElement("span");
            pill.className = "trajectory-tooltip__pill";
            pill.innerHTML = `<span class="trajectory-tooltip__pill-key">${key}</span> ${value}`;
            pillsDiv.appendChild(pill);
        }

        el.appendChild(pillsDiv);

        // "Show Trajectory" button — only if track_id and fov_name are available
        const trackId = fields.track_id;
        const fovName = fields.fov_name;
        if (trackId != null && fovName != null) {
            const btn = document.createElement("button");
            btn.className = "trajectory-tooltip__btn";
            btn.textContent = "\u2192 Show Trajectory";
            btn.addEventListener("click", () => {
                onShowTrajectory(Number(trackId), String(fovName), fields.t != null ? Number(fields.t) : undefined);
            });
            el.appendChild(btn);
        }
    }

    destroy() {
        this.container.remove();
    }
}

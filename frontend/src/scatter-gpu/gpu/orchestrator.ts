import tgpu from "typegpu";
import * as d from "typegpu/data";
import { createInteractionController } from "../hooks/useScatterInteraction";
import type { ScatterData, ScatterplotConfig, ScatterplotHandle } from "../types";
import { createBuffers, createUniforms, uploadData } from "./buffers";
import { createCullingEngine } from "./culling";
import { initGPU } from "./init";
import { createRenderPipeline } from "./pipeline";
import { createSelectionEngine } from "./selection";
import { createFragmentShader, createVertexShader } from "./shaders";

export async function createScatterplot(
    canvas: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    data: ScatterData,
    config?: ScatterplotConfig,
): Promise<ScatterplotHandle> {
    const t0 = performance.now();

    const gpu = await initGPU(canvas);
    const { root, device, context, format } = gpu;
    const tGpu = performance.now();
    console.log(`GPU init: ${(tGpu - t0).toFixed(1)}ms`);

    const pointRadius = config?.render?.pointRadius ?? 0.003;
    const selectionDimFactor = config?.render?.selectionDimFactor ?? 0.08;

    // Adaptive point sizing: computed once from point count (zoom-independent).
    // The vertex shader already has sqrt(zoom) for zoom-dependent sizing.
    const referenceCount = 50_000;
    const adaptiveScale = Math.max(0.3, Math.min(1.5, Math.sqrt(referenceCount / Math.max(1, data.numCells))));

    const uniforms = createUniforms(root, canvas.width / canvas.height, config?.render);
    uniforms.paramsUniform.write(d.vec4f(pointRadius, canvas.width / canvas.height, selectionDimFactor, adaptiveScale));
    const buffers = createBuffers(root, data.numCells, data.categoryNames.length);
    uploadData(root, device, buffers, data, config?.colorMapper, config?.palette);
    const tUpload = performance.now();
    console.log(`Buffer upload: ${(tUpload - tGpu).toFixed(1)}ms`);

    const culling = createCullingEngine(root, device, buffers, uniforms, data.numCells);

    // Default to transparent — let the CSS background-color of the container
    // show through. This makes the scatter canvas respond to dark/light theme
    // without requiring GPU re-initialization.
    const backgroundColor =
        config?.render?.backgroundColor ?? ([0, 0, 0, 0] as [number, number, number, number]);

    const mainVertex = createVertexShader(uniforms);
    const mainFragment = createFragmentShader();
    const { render } = createRenderPipeline(root, mainVertex, mainFragment, buffers, culling, format, backgroundColor, data.numCells);

    const selection = createSelectionEngine(root, device, buffers, uniforms, data.numCells, (count, indices) =>
        config?.callbacks?.onSelectionChange?.(count, indices),
    );
    const tPipelines = performance.now();
    console.log(`Pipeline setup: ${(tPipelines - tUpload).toFixed(1)}ms`);

    let currentZoom = 1;
    let viewVersion = 0;

    const interaction = createInteractionController(
        canvas,
        overlay,
        uniforms,
        selection,
        () => {
            // Guard against 0-size canvas (hidden/collapsed Dockview panel)
            if (canvas.width === 0 || canvas.height === 0) return;
            culling.dispatchCulling(viewVersion);
            render(context, data.numCells, "clear");
        },
        {
            onViewChange: (zoom: number) => {
                currentZoom = zoom;
                viewVersion++;
                config?.callbacks?.onViewChange?.(zoom);
            },
            onFps: (fps: number) => {
                config?.callbacks?.onFps?.(fps);
            },
            onPointClick: (worldX: number, worldY: number) => {
                const hitRadiusWorld = 20 / ((currentZoom * canvas.height) / 2);
                const maxDist2 = hitRadiusWorld * hitRadiusWorld;
                let bestIdx = -1;
                let bestDist2 = maxDist2;
                for (let i = 0; i < data.numCells; i++) {
                    const px = data.positions[i * 2]!;
                    const py = data.positions[i * 2 + 1]!;
                    const dx = px - worldX;
                    const dy = py - worldY;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < bestDist2) {
                        bestDist2 = d2;
                        bestIdx = i;
                    }
                }
                if (bestIdx >= 0) {
                    selection.selectPoint(bestIdx);
                    const px = data.positions[bestIdx * 2]!;
                    const py = data.positions[bestIdx * 2 + 1]!;
                    const catIdx = data.categoryIndices[bestIdx]!;
                    config?.callbacks?.onPointClick?.(bestIdx, [px, py], catIdx, data.categoryNames[catIdx]!);
                }
            },
        },
        config?.interaction,
    );

    console.log(
        `Scatterplot ready: ${data.numCells.toLocaleString()} points in ${(performance.now() - t0).toFixed(1)}ms`,
    );

    // Debug: dump generated WGSL when ?debug-wgsl is in the URL
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("debug-wgsl")) {
        console.log("=== Vertex + Fragment WGSL ===");
        console.log(tgpu.resolve([mainVertex, mainFragment]));
        console.log("=== PIP Compute WGSL ===");
        console.log(tgpu.resolve([selection.pipComputeFn]));
        console.log("=== Culling Compute WGSL ===");
        console.log(tgpu.resolve([culling.cullComputeFn]));
    }

    return {
        resize(width: number, height: number) {
            const dpr = window.devicePixelRatio || 1;
            const gpuW = Math.floor(width * dpr);
            const gpuH = Math.floor(height * dpr);

            uniforms.paramsUniform.write(d.vec4f(pointRadius, gpuW / gpuH, selectionDimFactor, adaptiveScale));
            interaction.resize();
        },
        updateColors(palette: readonly (readonly [number, number, number])[], categoryIndices?: Uint8Array) {
            // Use passed indices (fresh from latest data) or fall back to original closure data
            const indices = categoryIndices ?? data.categoryIndices;
            const colorData = new Float32Array(data.numCells * 4);
            for (let i = 0; i < data.numCells; i++) {
                const cat = (indices[i] ?? 0) % Math.max(1, palette.length);
                const entry = palette[cat];
                if (entry) {
                    colorData[i * 4] = entry[0];
                    colorData[i * 4 + 1] = entry[1];
                    colorData[i * 4 + 2] = entry[2];
                    colorData[i * 4 + 3] = 1.0;
                } else {
                    colorData[i * 4 + 3] = 1.0;
                }
            }
            device.queue.writeBuffer(root.unwrap(buffers.colorBuffer), 0, colorData);
            interaction.requestRender();
        },
        updateColorsDirect(rgba: Float32Array) {
            device.queue.writeBuffer(root.unwrap(buffers.colorBuffer), 0, rgba);
            interaction.requestRender();
        },
        getViewState() {
            return interaction.getViewState();
        },
        worldToScreen(wx: number, wy: number, w: number, h: number) {
            const { panX, panY, zoom } = interaction.getViewState();
            const aspect = w / h;
            const clipX = ((wx + panX) * zoom) / aspect;
            const clipY = (wy + panY) * zoom;
            return {
                x: ((clipX + 1) / 2) * w,
                y: (1 - (clipY + 1) / 2) * h,
            };
        },
        destroy() {
            interaction.destroy();
            selection.destroy();
            culling.destroy();
            root.destroy();
        },
    };
}

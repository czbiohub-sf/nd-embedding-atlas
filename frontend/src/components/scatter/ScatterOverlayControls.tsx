/**
 * ScatterOverlayControls — glassmorphic controls overlaid on the scatter canvas.
 *
 * Two zones, both absolute-positioned:
 *  top-left  → embedding + x/y dim comboboxes + color column combobox
 *  top-right → selection tool toggles + utility button group (lock, pip, fullscreen, close)
 */

import {
    Bookmark,
    BoxSelect,
    LassoSelect,
    Lock,
    LockOpen,
    Maximize2,
    PictureInPicture2Icon,
    Waypoints,
    X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { SaveObsSetDialog } from "./SaveObsSetDialog";

/** Scan + Dot combined — "fit embedding to view" */
function ScanDotIcon({ size = 12 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {/* Scan — corner brackets */}
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            {/* Dot — center point */}
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
    );
}

import { useStore } from "@tanstack/react-store";
import type { DockviewPanelApi } from "dockview-react";
import type { FloatingWindowHandle } from "../../hooks/useFloatingWindow";
import type { ColorSource } from "../../lib/color-source";
import { colorSourceToString } from "../../lib/color-source";
import { cn } from "../../lib/utils";
import type { ColorMode } from "../../scatter-gpu/hooks/useMosaicScatterData";
import { addFloatingScatter } from "../../stores/FloatingScatterStore";
import { toggleViewLock, viewSyncStore } from "../../stores/ViewSyncStore";
import type { AxisState } from "../../types";
import { ColorSourcePicker } from "../scatter/ColorSourcePicker";
import { ButtonGroup } from "../ui/button-group";
import { Combobox, type ComboboxOption } from "../ui/combobox";
import { HoverTip } from "../ui/hover-tip";
import { Separator } from "../ui/separator";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

interface Props {
    // Axes
    axes: AxisState;
    obsmKeys: string[];
    dims: number[];
    loadingKey: string | null;
    currentEntryLoaded: boolean;
    onSetAxes: (axes: AxisState) => void;

    // Color
    colorSource: ColorSource;
    obsColumns: string[];
    colorMode: ColorMode;
    colorModeCanToggle: boolean;
    /** Whether the dataset has a var/expression matrix — hides Var tab when false */
    hasVar: boolean;
    onSetColorSource: (src: ColorSource) => void;
    onToggleColorMode: () => void;

    // Selection tool
    selectionTool: "pan" | "marquee" | "lasso";
    onSetSelectionTool: (t: "pan" | "marquee" | "lasso") => void;
    onFitView?: () => void;
    floatingWindow?: FloatingWindowHandle;
    panelApi?: DockviewPanelApi;
    trajectoryActive?: boolean;
    onToggleTrajectory?: () => void;

    // ObsSet save
    hasSelection: boolean;
    selectionCount: number;
    /** Reads rowIndicesRef.current at call time — never stale */
    getRowIndices: () => readonly number[];
    selectionPath: "inline" | "temp_table";
}

const glass = "bg-card/75 backdrop-blur-md border border-white/[0.07] rounded-lg shadow-sm";

/** Glass-styled combobox trigger for use inside the overlay zones. */
const glassTrigger =
    "h-6 max-w-28 border-0 bg-transparent px-1.5 text-[11px] gap-1 text-foreground/80 hover:bg-white/10 hover:text-foreground focus-visible:ring-0";

export function ScatterOverlayControls({
    axes,
    obsmKeys,
    dims,
    loadingKey,
    currentEntryLoaded,
    onSetAxes,
    colorSource,
    obsColumns,
    colorMode,
    colorModeCanToggle,
    hasVar,
    onSetColorSource,
    onToggleColorMode,
    selectionTool,
    onSetSelectionTool,
    onFitView,
    floatingWindow,
    panelApi,
    trajectoryActive,
    onToggleTrajectory,
    hasSelection,
    selectionCount,
    getRowIndices,
    selectionPath,
}: Props) {
    const [saveDialogOpen, setSaveDialogOpen] = useState(false);
    const lockMode = useStore(viewSyncStore, (s) => s.lockMode);
    const isLinked = lockMode === "linked";
    const disabled = loadingKey !== null;

    // Memoize option arrays to avoid churn on every render
    const embeddingOptions = useMemo<ComboboxOption[]>(
        () => obsmKeys.map((k) => ({ value: k, label: k.replace(/^X_/, "") })),
        [obsmKeys],
    );
    const dimOptions = useMemo<ComboboxOption[]>(
        () => dims.map((d) => ({ value: String(d), label: String(d) })),
        [dims],
    );

    return (
        <>
            {/* ── Top-left: embedding + dims + color ── */}
            <div
                className={cn(
                    "absolute top-2 left-2 z-20 flex items-center gap-1 px-2 py-1",
                    glass,
                )}
            >
                {/* Embedding */}
                <Combobox
                    value={axes.obsmKey}
                    onValueChange={(v) => v && onSetAxes({ obsmKey: v, xDim: 0, yDim: 1 })}
                    options={embeddingOptions}
                    placeholder="embedding"
                    searchPlaceholder="Search embeddings…"
                    disabled={disabled}
                    triggerClassName={cn(glassTrigger, "max-w-32")}
                    contentClassName="w-48"
                />

                <Separator orientation="vertical" className="h-3 bg-white/[0.07]" />

                {/* X dim */}
                <span className="text-[10px] text-muted-foreground/60">x</span>
                <Combobox
                    value={String(axes.xDim)}
                    onValueChange={(v) => v !== "" && onSetAxes({ ...axes, xDim: Number(v) })}
                    options={dimOptions}
                    placeholder="0"
                    searchPlaceholder="Search dims…"
                    disabled={disabled || !currentEntryLoaded}
                    triggerClassName={cn(glassTrigger, "max-w-[3rem]")}
                    contentClassName="w-32"
                />

                {/* Y dim */}
                <span className="text-[10px] text-muted-foreground/60">y</span>
                <Combobox
                    value={String(axes.yDim)}
                    onValueChange={(v) => v !== "" && onSetAxes({ ...axes, yDim: Number(v) })}
                    options={dimOptions}
                    placeholder="1"
                    searchPlaceholder="Search dims…"
                    disabled={disabled || !currentEntryLoaded}
                    triggerClassName={cn(glassTrigger, "max-w-[3rem]")}
                    contentClassName="w-32"
                />

                <Separator orientation="vertical" className="h-3 bg-white/[0.07]" />

                {/* Color column */}
                <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                    col
                </span>
                <ColorSourcePicker
                    colorSource={colorSource}
                    obsColumns={obsColumns}
                    hasVar={hasVar}
                    onSetColorSource={onSetColorSource}
                    triggerClassName={cn(glassTrigger, "max-w-36")}
                    contentClassName="w-64"
                />

                {colorModeCanToggle && (
                    <>
                        <Separator orientation="vertical" className="h-3 bg-white/[0.07]" />
                        <button
                            type="button"
                            onClick={onToggleColorMode}
                            className="px-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:text-foreground"
                        >
                            {colorMode === "continuous" ? "scale" : "palette"}
                        </button>
                    </>
                )}
            </div>

            {/* ── Top-right: selection tools + utility actions ── */}
            <div
                className={cn(
                    "absolute top-2 right-2 z-20 flex items-center gap-1.5 px-1.5 py-1",
                    glass,
                )}
            >
                {/* Selection tool toggles */}
                <ToggleGroup
                    value={selectionTool === "pan" ? [] : [selectionTool]}
                    onValueChange={(v: string[]) =>
                        onSetSelectionTool((v[v.length - 1] as "marquee" | "lasso") ?? "pan")
                    }
                    className="gap-0"
                >
                    <HoverTip
                        label="Rectangle"
                        description="Drag to select a region"
                        side="bottom"
                        render={
                            <ToggleGroupItem
                                value="marquee"
                                size="sm"
                                className="size-[22px] border-0 bg-transparent text-muted-foreground data-[state=on]:bg-white/15 data-[state=on]:text-foreground"
                            />
                        }
                    >
                        <BoxSelect className="size-3.5" />
                    </HoverTip>
                    <HoverTip
                        label="Lasso"
                        description="Trace a freehand region"
                        side="bottom"
                        render={
                            <ToggleGroupItem
                                value="lasso"
                                size="sm"
                                className="size-[22px] border-0 bg-transparent text-muted-foreground data-[state=on]:bg-white/15 data-[state=on]:text-foreground"
                            />
                        }
                    >
                        <LassoSelect className="size-3.5" />
                    </HoverTip>
                </ToggleGroup>

                {hasSelection && (
                    <>
                        <Separator orientation="vertical" className="mx-0.5 h-3 bg-white/[0.07]" />
                        <HoverTip
                            label="Save selection"
                            description={`Save ${selectionCount} obs as an ObsSet`}
                            side="bottom"
                            render={
                                <button
                                    type="button"
                                    onClick={() => setSaveDialogOpen(true)}
                                    className="flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                                />
                            }
                        >
                            <Bookmark className="size-3.5" />
                        </HoverTip>
                    </>
                )}

                <Separator orientation="vertical" className="mx-0.5 h-3 bg-white/[0.07]" />

                {/* Utility actions as a ButtonGroup */}
                <ButtonGroup className="border-white/[0.07] bg-transparent">
                    {onToggleTrajectory && (
                        <HoverTip
                            label="Track"
                            description={
                                trajectoryActive
                                    ? "Hide the trajectory"
                                    : "Show the cell's trajectory"
                            }
                            side="bottom"
                            render={
                                <button
                                    type="button"
                                    onClick={onToggleTrajectory}
                                    className={cn(
                                        "flex size-[22px] items-center justify-center bg-transparent transition-colors hover:bg-white/10",
                                        trajectoryActive
                                            ? "text-primary"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}
                                />
                            }
                        >
                            <Waypoints className="size-3" />
                        </HoverTip>
                    )}
                    {onFitView && (
                        <HoverTip
                            label="Fit view"
                            description="Zoom out to show all points"
                            side="bottom"
                            render={
                                <button
                                    type="button"
                                    onClick={onFitView}
                                    className="flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                                />
                            }
                        >
                            <ScanDotIcon size={12} />
                        </HoverTip>
                    )}
                    <HoverTip
                        label={isLinked ? "Views linked" : "Link views"}
                        description={
                            isLinked
                                ? "Click to pan each panel freely"
                                : "Sync pan and zoom across panels"
                        }
                        side="bottom"
                        render={
                            <button
                                type="button"
                                onClick={toggleViewLock}
                                className={cn(
                                    "flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                                    isLinked && "text-primary",
                                )}
                            />
                        }
                    >
                        {isLinked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
                    </HoverTip>

                    {floatingWindow && (
                        <HoverTip
                            label={floatingWindow.state.open ? "Floating" : "Float"}
                            description={
                                floatingWindow.state.open
                                    ? "Return to docked panel"
                                    : "Detach to a floating window"
                            }
                            side="bottom"
                            render={
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (floatingWindow.state.open) {
                                            floatingWindow.close();
                                        } else {
                                            addFloatingScatter({
                                                id: `float-${Date.now()}`,
                                                axes,
                                                colorByColumn: colorSourceToString(colorSource),
                                            });
                                            panelApi?.close();
                                        }
                                    }}
                                    className={cn(
                                        "flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                                        floatingWindow.state.open && "text-primary",
                                    )}
                                />
                            }
                        >
                            <PictureInPicture2Icon className="size-3" />
                        </HoverTip>
                    )}

                    {panelApi && (
                        <HoverTip
                            label="Fullscreen"
                            description="Fill the workspace"
                            side="bottom"
                            render={
                                <button
                                    type="button"
                                    onClick={() =>
                                        panelApi.isMaximized()
                                            ? panelApi.exitMaximized()
                                            : panelApi.maximize()
                                    }
                                    className="flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                                />
                            }
                        >
                            <Maximize2 className="size-3" />
                        </HoverTip>
                    )}

                    {panelApi && (
                        <HoverTip
                            label="Close"
                            description="Remove this panel"
                            side="bottom"
                            render={
                                <button
                                    type="button"
                                    onClick={() => panelApi.close()}
                                    className="flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-destructive"
                                />
                            }
                        >
                            <X className="size-3" />
                        </HoverTip>
                    )}
                </ButtonGroup>
            </div>

            <SaveObsSetDialog
                open={saveDialogOpen}
                onClose={() => setSaveDialogOpen(false)}
                selectionPath={selectionPath}
                getRowIndices={getRowIndices}
            />
        </>
    );
}

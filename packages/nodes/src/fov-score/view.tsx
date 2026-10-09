/**
 * fov-score: tune the desirability model that decides which fields of view get imaged, and
 * emit it as the yaml shrimPy ingests.
 *
 * This is the node the whole dashboard exists to serve. The plate grid supplies the labels,
 * the scatter and table supply context, and everything lands here: a curve per feature, one
 * accuracy readout saying how well those curves agree with the human labels, and one export
 * button. The tool's responsibility ends at the yaml.
 *
 * Scoring is live rather than behind a "re-rank" button. The Qt tool needed one because it
 * recomputed in Python across a process boundary; here 147 rows x 15 features is a fraction
 * of a frame, so the accuracy number moves while a handle is being dragged — which is the
 * whole point of having it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@ndea/ui/components/button";
import { ButtonGroup } from "@ndea/ui/components/button-group";
import { Input } from "@ndea/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { SliderRow } from "@ndea/ui/components/slider-row";
import { useConfigState } from "../fov-label/useConfigState";
import { GOODNESS_TEXT, type Goodness } from "../fov-label/goodness";
import { useAnnotationColumns } from "../query/annotations";
import { useNodeFocus } from "../query/useNodeFocus";
import { CurvePlot, type FocusMarker } from "./CurvePlot";
import { defaultSpec, featureStats, type FeatureStats } from "./defaults";
import {
  AGGREGATIONS,
  type Aggregation,
  type CurveParams,
  DEFAULT_AGGREGATION,
  type FeatureSpec,
  scoreFov,
} from "./desirability";
import { FeatureTable } from "./FeatureTable";
import { featureColumns } from "./feature-columns";
import { featureHistogram } from "./histogram";
import { scoreMetrics } from "./metrics";
import { useFeatureMatrix } from "./useFeatureMatrix";
import { emitModelYaml } from "./yaml";
import type { FovScoreBodyProps } from "./contracts";

/** Plot edge in px. The floor still shows a distribution; the ceiling is for one feature. */
const PLOT_PX_MIN = 140;
const PLOT_PX_MAX = 460;
const DEFAULT_PLOT_PX = 220;
/** Plot height as a fraction of width: wide and short, so more features fit on screen. */
const PLOT_ASPECT = 0.55;
const DEFAULT_BINS = 24;
/** shrimPy needs a number; 20 is what the demo config keeps. */
const DEFAULT_TOP_FOV = 20;

type Pane = "table" | "yaml" | "none";

/** Save as a file the operator can hand to shrimPy. */
function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function FovScoreView({ host }: FovScoreBodyProps) {
  const metadata = host.data.metadata;
  const columns = useMemo(() => metadata.obs_columns ?? [], [metadata.obs_columns]);
  const names = useMemo(() => featureColumns(columns), [columns]);

  /**
   * The tuned model, held locally and persisted DELIBERATELY, not on every change.
   *
   * `host.patchConfig` costs ~180ms measured: it mutates the workspace document, which re-cooks
   * the graph and re-renders every staged panel. Calling it per pointermove capped dragging at
   * ~4fps, and 99.7% of that frame was React reconcile — the scoring math is 0.7ms. So a drag
   * moves this state only, and the write happens once, when the gesture ends.
   *
   * A ref alongside the state, not `useState`'s updater form, so every setter below can be
   * dependency-free and therefore referentially stable — which is what lets `CurvePlot` be
   * memoized. Without stable callbacks all 15 plots re-render on every frame regardless.
   */
  const [features, setFeaturesState] = useState<Record<string, FeatureSpec>>(host.config.features ?? {});
  const featuresRef = useRef(features);

  const apply = useCallback((next: Record<string, FeatureSpec>) => {
    featuresRef.current = next;
    setFeaturesState(next);
  }, []);
  const persist = useCallback((next: Record<string, FeatureSpec>) => host.patchConfig({ features: next }), [host]);

  const [aggregation, setAggregation] = useConfigState<Aggregation>(
    host.config.aggregation ?? DEFAULT_AGGREGATION,
    useCallback((value: Aggregation) => host.patchConfig({ aggregation: value }), [host]),
  );
  const [topFov, setTopFov] = useConfigState(
    host.config.topFov ?? DEFAULT_TOP_FOV,
    useCallback((value: number) => host.patchConfig({ topFov: value }), [host]),
  );
  const [bins, setBins] = useConfigState(
    host.config.bins ?? DEFAULT_BINS,
    useCallback((value: number) => host.patchConfig({ bins: value }), [host]),
  );
  // Local while dragging; persisted once on release, like the curve params above.
  const [plotPx, setPlotPx] = useState(host.config.plotPx ?? DEFAULT_PLOT_PX);
  const persistPlotPx = useCallback((px: number) => host.patchConfig({ plotPx: px }), [host]);
  const [pane, setPane] = useConfigState<Pane>(
    host.config.pane ?? "table",
    useCallback((value: Pane) => host.patchConfig({ pane: value }), [host]),
  );

  // Annotation columns are NOT in `metadata.obs_columns` -- they live in `ann_{name}` tables
  // joined into the view -- so without asking the server, a label made in the plate grid is
  // never read and the accuracy readout silently scores against the import alone.
  const annotations = useAnnotationColumns();

  const { rows, isLoading, error } = useFeatureMatrix({
    coordinator: host.data.coordinator,
    columns,
    features: names,
    nameColumn: metadata.spatial?.crop_fov_col ?? null,
    annotationColumns: annotations.columns,
    annotationRevision: annotations.revision,
    annotationsReady: annotations.isReady,
  });

  // Follow a FOV picked in the scatter, the plate grid, the gallery or the table.
  const focusedRowIndex = useNodeFocus(host);
  const focused = useMemo(
    () => (focusedRowIndex == null ? null : (rows.find((row) => row.rowIndex === focusedRowIndex) ?? null)),
    [focusedRowIndex, rows],
  );

  const stats = useMemo(() => {
    const out: Record<string, FeatureStats> = {};
    for (const name of names) out[name] = featureStats(rows.map((row) => row.values[name]));
    return out;
  }, [names, rows]);

  // Seed any feature the config has never seen. Reads the ref rather than the state so
  // `features` stays out of the dependency list: with it in, every drag frame re-runs this.
  useEffect(() => {
    if (rows.length === 0) return;
    const missing = names.filter((name) => !featuresRef.current[name]);
    if (missing.length === 0) return;
    const seeded = { ...featuresRef.current };
    for (const name of missing) seeded[name] = defaultSpec(stats[name]);
    apply(seeded);
    persist(seeded);
  }, [rows.length, names, stats, apply, persist]);

  const histograms = useMemo(() => {
    const out: Record<string, ReturnType<typeof featureHistogram>> = {};
    for (const name of names) {
      const stat = stats[name];
      out[name] = featureHistogram(
        rows.map((row) => ({ value: row.values[name], goodness: row.goodness })),
        bins,
        // Pin the axis to the DATA extent, not the curve's. Otherwise dragging a handle past
        // the last value would rescale the axis under the cursor mid-gesture.
        stat && stat.hi > stat.lo ? [stat.lo, stat.hi] : undefined,
      );
    }
    return out;
  }, [names, rows, bins, stats]);

  const profile = useMemo(() => ({ aggregation, features }), [aggregation, features]);

  const scored = useMemo(
    () => rows.map((row) => ({ score: scoreFov(profile, row.values), goodness: row.goodness })),
    [profile, rows],
  );
  const metrics = useMemo(() => scoreMetrics(scored), [scored]);

  /**
   * Where the focused FOV lands under the current model.
   *
   * Rank, not just score, because `top_fov` is the only thing the acquisition acts on — a
   * score of 0.87 means nothing on its own, "rank 4, kept" means everything.
   */
  const focusedRank = useMemo(() => {
    if (!focused) return null;
    const score = scoreFov(profile, focused.values);
    return { score, rank: scored.filter((row) => row.score > score).length + 1 };
  }, [focused, profile, scored]);

  const counts = useMemo(() => {
    const out: Record<Goodness, number> = { good: 0, neutral: 0, bad: 0, unlabeled: 0 };
    for (const row of rows) out[row.goodness] += 1;
    return out;
  }, [rows]);

  const enabledCount = names.filter((name) => features[name]?.enabled).length;
  // Constant across the 15 plots, so it is not recomputed per child.
  const plotHeight = Math.round(plotPx * PLOT_ASPECT);

  const [yamlText, yamlError] = useMemo(() => {
    try {
      return [
        emitModelYaml(profile, {
          topFov,
          // How well this config agreed with the labels it was tuned against, and how many
          // labels that was. Someone reading the file six months from now needs to know
          // whether it was fitted to 147 labelled fields or to nine. Deliberately no dataset
          // path or timestamp: `Metadata` carries neither (`props.data.id` is the obs-name
          // COLUMN, not a dataset), and a clock would make the file irreproducible.
          provenance: [
            "nd-embedding-atlas fov-score",
            `tuned against ${metrics.labeled} labelled FOVs -- pairwise ${metrics.pairwiseAccuracy.toFixed(3)}, top-${metrics.topN} ${metrics.topNHits}/${metrics.topN}`,
          ].join("\n"),
        }),
        null,
      ] as const;
    } catch (err) {
      return [null, err instanceof Error ? err.message : String(err)] as const;
    }
  }, [profile, topFov, metrics]);

  /** A discrete edit — a typed number, a shape change. Cheap enough to persist immediately. */
  const setSpec = useCallback(
    (name: string, spec: FeatureSpec) => {
      const next = { ...featuresRef.current, [name]: spec };
      apply(next);
      persist(next);
    },
    [apply, persist],
  );

  /** One drag frame. Local only; `commitParams` does the write when the gesture ends. */
  const setParams = useCallback(
    (name: string, params: CurveParams) => {
      const spec = featuresRef.current[name];
      if (!spec) return;
      apply({ ...featuresRef.current, [name]: { ...spec, params } });
    },
    [apply],
  );

  /** End of a drag: one workspace write for the whole gesture instead of one per frame. */
  const commitParams = useCallback(() => persist(featuresRef.current), [persist]);

  const toggleFeature = useCallback(
    (name: string) => {
      const spec = featuresRef.current[name];
      if (spec) setSpec(name, { ...spec, enabled: !spec.enabled });
    },
    [setSpec],
  );

  const setAll = useCallback(
    (enabled: boolean) => {
      const next = { ...featuresRef.current };
      for (const name of Object.keys(next)) next[name] = { ...next[name], enabled };
      apply(next);
      persist(next);
    },
    [apply, persist],
  );

  /**
   * One marker object per feature, memoized on the focused row.
   *
   * Built up front rather than inline in the map: `marker={focused ? {...} : null}` allocates a
   * fresh object every render, which changes the prop identity and defeats `CurvePlot`'s memo
   * for all 15 plots on every frame.
   */
  const markers = useMemo(() => {
    const out: Record<string, FocusMarker | null> = {};
    for (const name of names) {
      out[name] = focused ? { value: focused.values[name], goodness: focused.goodness, label: focused.name } : null;
    }
    return out;
  }, [names, focused]);

  if (names.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center">
        <div className="max-w-[280px] text-2xs text-muted-foreground/60 leading-relaxed">
          No scoreable feature columns in this dataset. Needs numeric per-FOV measurements in
          <code> obs</code> — identifiers, labels and model outputs are excluded.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-node-surface">
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 font-mono text-2xs">
        <span className="text-foreground/70">
          {rows.length} FOV{rows.length === 1 ? "" : "s"} · {enabledCount}/{names.length} features
        </span>
        <span className="flex items-center gap-1.5">
          {(["good", "neutral", "bad", "unlabeled"] as const).map((value) => (
            <span key={value} className={GOODNESS_TEXT[value]} title={`${counts[value]} ${value}`}>
              {counts[value]}
              {value === "unlabeled" ? "?" : value[0].toUpperCase()}
            </span>
          ))}
        </span>

        <span
          className="text-foreground"
          title={`Pairwise: of ${metrics.pairs} good/neutral/bad pairs, the fraction the score orders correctly (0.5 is chance). Top-N: of the ${metrics.topN} best-scoring FOVs, how many are actually labelled good.`}
        >
          pair <span className="text-primary">{metrics.pairwiseAccuracy.toFixed(3)}</span>
          <span className="text-muted-foreground/60"> ({metrics.pairs})</span> · top-{metrics.topN}{" "}
          <span className="text-primary">{metrics.topNAccuracy.toFixed(3)}</span>
          <span className="text-muted-foreground/60">
            {" "}
            ({metrics.topNHits}/{metrics.topN})
          </span>
        </span>

        {focused && focusedRank && (
          <span
            className={`flex items-center gap-1 ${GOODNESS_TEXT[focused.goodness]}`}
            title={`Focused FOV, marked on every plot. ${
              focusedRank.rank <= topFov
                ? `Rank ${focusedRank.rank} of ${rows.length} -- inside the top ${topFov} this config would keep.`
                : `Rank ${focusedRank.rank} of ${rows.length} -- outside the top ${topFov} this config would keep.`
            }`}
          >
            ◈ {focused.name}
            <span className="text-muted-foreground/60">
              {focusedRank.score.toFixed(3)} · rank {focusedRank.rank}
            </span>
            {focusedRank.rank <= topFov && <span className="text-primary">keep</span>}
          </span>
        )}

        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <label
            className="flex items-center gap-1 text-muted-foreground"
            title="How per-feature scores are aggregated"
          >
            aggregation
            <Select value={aggregation} onValueChange={(value) => setAggregation(value as Aggregation)}>
              <SelectTrigger aria-label="aggregation" className="h-5 w-[86px] px-1 text-[0.625rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGGREGATIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label
            className="flex items-center gap-1 text-muted-foreground"
            title="How many top-ranked FOVs the acquisition keeps. Ranking only -- there is no score threshold."
          >
            top_fov
            <Input
              type="number"
              min={1}
              step={1}
              aria-label="top_fov"
              className="h-5 w-14 px-1 font-mono text-[0.625rem]"
              value={topFov}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isInteger(next) && next >= 1) setTopFov(next);
              }}
            />
          </label>

          <label className="flex items-center gap-1 text-muted-foreground" title="Histogram bins">
            bins
            <Input
              type="number"
              min={4}
              max={128}
              step={1}
              aria-label="bins"
              className="h-5 w-12 px-1 font-mono text-[0.625rem]"
              value={bins}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isInteger(next) && next >= 4 && next <= 128) setBins(next);
              }}
            />
          </label>

          <ButtonGroup>
            <Button type="button" size="xs" variant="ghost" title="Enable every feature" onClick={() => setAll(true)}>
              all
            </Button>
            <Button type="button" size="xs" variant="ghost" title="Disable every feature" onClick={() => setAll(false)}>
              none
            </Button>
          </ButtonGroup>

          {/* Same reason as the curve drag: `patchConfig` costs ~180ms, so the live value is
              local and only the released value is persisted. */}
          <SliderRow
            label="size"
            value={plotPx}
            min={PLOT_PX_MIN}
            max={PLOT_PX_MAX}
            step={10}
            className="w-40 flex-none"
            labelClassName="w-7"
            valueClassName="w-8"
            formatValue={(px) => `${px}px`}
            onValueChange={setPlotPx}
            onValueCommitted={persistPlotPx}
          />

          <ButtonGroup>
            {(["table", "yaml", "none"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="xs"
                variant={value === pane ? "secondary" : "ghost"}
                aria-pressed={value === pane}
                title={
                  value === "table"
                    ? "Show the parameter table"
                    : value === "yaml"
                      ? "Show the yaml this config exports"
                      : "Plots only"
                }
                onClick={() => setPane(value)}
              >
                {value}
              </Button>
            ))}
          </ButtonGroup>

          <Button
            type="button"
            size="xs"
            variant="default"
            disabled={yamlText == null}
            title={yamlError ?? "Save the model block shrimPy ingests"}
            onClick={() => yamlText && downloadText("fov_selection_model.yml", yamlText)}
          >
            export yaml
          </Button>
        </span>
      </div>

      {(error ?? annotations.error) && (
        <div className="flex-none px-2 font-mono text-[9px] text-destructive">✗ {error ?? annotations.error}</div>
      )}
      {isLoading && rows.length === 0 && (
        <div className="px-2 py-2 text-2xs text-muted-foreground/60">Loading feature matrix…</div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          {names.map((name) => {
            const spec = features[name];
            const histogram = histograms[name];
            if (!spec || !histogram) return null;
            return (
              <CurvePlot
                key={name}
                name={name}
                spec={spec}
                histogram={histogram}
                width={plotPx}
                height={plotHeight}
                marker={markers[name]}
                onParams={setParams}
                onCommit={commitParams}
                onToggle={toggleFeature}
              />
            );
          })}
        </div>
      </div>

      {pane === "table" && (
        <div className="flex max-h-[45%] min-h-0 flex-none flex-col border-border/40 border-t">
          <FeatureTable names={names} features={features} stats={stats} onSpec={setSpec} />
        </div>
      )}

      {pane === "yaml" && (
        <div className="flex max-h-[45%] min-h-0 flex-none flex-col border-border/40 border-t">
          <div className="flex flex-none items-center gap-2 px-2 py-1">
            <span className="font-mono text-2xs text-muted-foreground">fov_selection model block</span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="ml-auto"
              disabled={yamlText == null}
              title="Copy to the clipboard"
              onClick={() => yamlText && void navigator.clipboard?.writeText(yamlText)}
            >
              copy
            </Button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto px-2 pb-2 font-mono text-[0.625rem] leading-snug">
            {yamlText ?? `✗ ${yamlError}`}
          </pre>
        </div>
      )}
    </div>
  );
}

export { createFovScoreDefinition } from "./definition";
export { CurvePlot, formatNumber } from "./CurvePlot";
export { FeatureTable } from "./FeatureTable";
export { defaultParams, defaultSpec, featureStats, type FeatureStats } from "./defaults";
export {
  aggregate,
  AGGREGATIONS,
  curveBounds,
  curveParams,
  DEFAULT_AGGREGATION,
  desirability,
  DIRECTIONS,
  gaussianBounds,
  lognormalBounds,
  MISSING_DESIRABILITY,
  MISSING_Z2,
  SHAPES,
  scoreFov,
  squaredDistance,
  type Aggregation,
  type CurveBounds,
  type CurveParams,
  type Direction,
  type FeatureSpec,
  type ScoreProfile,
  type Shape,
} from "./desirability";
export { curveHandles, dragHandle, type CurveHandle } from "./handles";
export { featureHistogram, type FeatureHistogram, type HistogramBin } from "./histogram";
export { featureColumns, isFeatureColumn } from "./feature-columns";
export { scoreMetrics, type ScoredFov, type ScoreMetrics } from "./metrics";
export { useFeatureMatrix, type FeatureMatrix, type FeatureRow } from "./useFeatureMatrix";
export { emitModelYaml, type EmitOptions } from "./yaml";
export type { FovScoreConfig, FovScoreCapabilities, FovScoreBodyProps } from "./contracts";

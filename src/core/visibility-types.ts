import type { BuildingEdge, PreparedBuilding } from "./dataset-types.js";

export interface ParameterInterval {
  readonly start: number;
  readonly end: number;
}

export interface EdgeVisibility {
  readonly edge: BuildingEdge;
  readonly visibleIntervals: readonly ParameterInterval[];
  readonly visibleLengthMeters: number;
}

export interface BuildingVisibility {
  readonly building: PreparedBuilding;
  readonly edges: readonly EdgeVisibility[];
  readonly visibleLengthMeters: number;
  readonly perimeterMeters: number;
  readonly coverage: number;
  readonly coverageKind: "complete" | "lower-bound";
  readonly processedAntennaCount: number;
}

export interface VisibilityComputationOptions {
  readonly requiredVisibleLengthMeters?: number;
  readonly fullDiagnosticCoverage?: boolean;
  readonly signal?: AbortSignal;
}

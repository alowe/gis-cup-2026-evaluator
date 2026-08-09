import type { SolutionWarning } from "./solution-types.js";
import type { ValidatedSubproblemInput } from "./submission-types.js";
import type { BuildingVisibility } from "./visibility-types.js";

export interface EvaluatedBuildingClaim {
  readonly buildingId: string;
  readonly verified: boolean;
  readonly coverageKind: "complete" | "lower-bound";
  readonly coverage: number;
  readonly visibleLengthMeters: number;
  readonly requiredVisibleLengthMeters: number;
  readonly visibility: BuildingVisibility;
}

export interface EvaluatedSubproblem {
  readonly input: ValidatedSubproblemInput;
  readonly buildingResults: readonly EvaluatedBuildingClaim[];
  readonly verifiedBuildingIds: readonly string[];
  readonly verifiedServiceScore: number;
  readonly warnings: readonly SolutionWarning[];
}

export interface EvaluationInstrumentation {
  readonly onBuildingEvaluation?: (buildingId: string) => void;
}

export interface EvaluationProgress {
  readonly subproblemIndex: number;
  readonly buildingId: string;
  readonly completedBuildingCount: number;
  readonly totalBuildingCount: number;
}

export interface EvaluationOptions extends EvaluationInstrumentation {
  readonly fullDiagnosticCoverage?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: EvaluationProgress) => void;
}

import type { BuildingDataset } from "./dataset-types.js";
import type {
  EvaluatedBuildingClaim,
  EvaluatedSubproblem,
  EvaluationInstrumentation,
} from "./evaluation-types.js";
import type { SolutionWarning } from "./solution-types.js";
import type { ValidatedSubproblemInput } from "./submission-types.js";
import { computeBuildingVisibility } from "./visibility-engine.js";

export function evaluateValidatedSubproblem(
  dataset: BuildingDataset,
  input: ValidatedSubproblemInput,
  instrumentation: EvaluationInstrumentation = {},
): EvaluatedSubproblem {
  const warnings: SolutionWarning[] = [...input.warnings];
  const buildingResults: EvaluatedBuildingClaim[] = [];
  const verifiedBuildingIds: string[] = [];
  const tau = input.source.tau;

  if (!input.source.complete || !input.source.parametersValid || tau === undefined) {
    return {
      input,
      buildingResults,
      verifiedBuildingIds,
      verifiedServiceScore: 0,
      warnings,
    };
  }

  for (const buildingId of input.claims.uniqueKnownIds) {
    instrumentation.onBuildingEvaluation?.(buildingId);

    try {
      const visibility = computeBuildingVisibility(dataset, buildingId, input.uniqueAntennas);
      const requiredVisibleLengthMeters = tau * visibility.perimeterMeters;
      const verified = visibility.visibleLengthMeters >= requiredVisibleLengthMeters;
      const result: EvaluatedBuildingClaim = {
        buildingId,
        verified,
        coverageKind: "complete",
        coverage: visibility.coverage,
        visibleLengthMeters: visibility.visibleLengthMeters,
        requiredVisibleLengthMeters,
        visibility,
      };
      buildingResults.push(result);

      if (verified) {
        verifiedBuildingIds.push(buildingId);
      } else {
        warnings.push({
          code: "CLAIM_BELOW_THRESHOLD",
          subproblemIndex: input.source.index,
          buildingId,
          message: `Claimed building ${JSON.stringify(buildingId)} has coverage ${visibility.coverage}, below tau=${tau}.`,
          action: "Exclude this building from the verified service score.",
        });
      }
    } catch (error: unknown) {
      warnings.push({
        code: "NUMERICAL_FAILURE",
        subproblemIndex: input.source.index,
        buildingId,
        message: `Building ${JSON.stringify(buildingId)} could not be evaluated: ${error instanceof Error ? error.message : "unknown geometry failure"}`,
        action: "Exclude this building from the verified service score.",
      });
    }
  }

  return {
    input,
    buildingResults,
    verifiedBuildingIds,
    verifiedServiceScore: verifiedBuildingIds.length,
    warnings,
  };
}


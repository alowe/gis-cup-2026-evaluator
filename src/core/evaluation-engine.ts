import type { BuildingDataset } from "./dataset-types.js";
import type {
  EvaluatedBuildingClaim,
  EvaluatedSubproblem,
  EvaluationOptions,
} from "./evaluation-types.js";
import type { SolutionWarning } from "./solution-types.js";
import type { ValidatedSubproblemInput } from "./submission-types.js";
import { computeBuildingVisibility } from "./visibility-engine.js";

export function evaluateValidatedSubproblem(
  dataset: BuildingDataset,
  input: ValidatedSubproblemInput,
  options: EvaluationOptions = {},
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

  for (const [buildingIndex, buildingId] of input.claims.uniqueKnownIds.entries()) {
    throwIfAborted(options.signal);
    options.onBuildingEvaluation?.(buildingId);

    try {
      const building = dataset.buildingById.get(buildingId);
      if (building === undefined) throw new Error("Validated building is missing from the dataset.");
      const requiredVisibleLengthMeters = tau * building.perimeterMeters;
      const visibility = computeBuildingVisibility(dataset, buildingId, input.uniqueAntennas, {
        requiredVisibleLengthMeters,
        fullDiagnosticCoverage: options.fullDiagnosticCoverage,
        signal: options.signal,
      });
      const verified = visibility.visibleLengthMeters >= requiredVisibleLengthMeters;
      const result: EvaluatedBuildingClaim = {
        buildingId,
        verified,
        coverageKind: visibility.coverageKind,
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
      if (isAbortError(error)) throw error;
      warnings.push({
        code: "NUMERICAL_FAILURE",
        subproblemIndex: input.source.index,
        buildingId,
        message: `Building ${JSON.stringify(buildingId)} could not be evaluated: ${error instanceof Error ? error.message : "unknown geometry failure"}`,
        action: "Exclude this building from the verified service score.",
      });
    }

    options.onProgress?.({
      subproblemIndex: input.source.index,
      buildingId,
      completedBuildingCount: buildingIndex + 1,
      totalBuildingCount: input.claims.uniqueKnownIds.length,
    });
  }

  return {
    input,
    buildingResults,
    verifiedBuildingIds,
    verifiedServiceScore: verifiedBuildingIds.length,
    warnings,
  };
}

export async function evaluateValidatedSubproblemAsync(
  dataset: BuildingDataset,
  input: ValidatedSubproblemInput,
  options: EvaluationOptions = {},
): Promise<EvaluatedSubproblem> {
  if (
    !input.source.complete
    || !input.source.parametersValid
    || input.source.tau === undefined
    || input.claims.uniqueKnownIds.length === 0
  ) {
    return evaluateValidatedSubproblem(dataset, input, options);
  }

  const warnings: SolutionWarning[] = [...input.warnings];
  const buildingResults: EvaluatedSubproblem["buildingResults"][number][] = [];
  const verifiedBuildingIds: string[] = [];

  for (const [buildingIndex, buildingId] of input.claims.uniqueKnownIds.entries()) {
    await yieldToWorkerEventLoop();
    throwIfAborted(options.signal);

    const singleClaimInput: ValidatedSubproblemInput = {
      ...input,
      claims: {
        ...input.claims,
        uniqueKnownIds: [buildingId],
      },
      warnings: [],
    };
    const singleResult = evaluateValidatedSubproblem(dataset, singleClaimInput, {
      fullDiagnosticCoverage: options.fullDiagnosticCoverage,
      signal: options.signal,
      onBuildingEvaluation: options.onBuildingEvaluation,
    });
    buildingResults.push(...singleResult.buildingResults);
    verifiedBuildingIds.push(...singleResult.verifiedBuildingIds);
    warnings.push(...singleResult.warnings);
    options.onProgress?.({
      subproblemIndex: input.source.index,
      buildingId,
      completedBuildingCount: buildingIndex + 1,
      totalBuildingCount: input.claims.uniqueKnownIds.length,
    });
  }

  return {
    input,
    buildingResults,
    verifiedBuildingIds,
    verifiedServiceScore: verifiedBuildingIds.length,
    warnings,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Evaluation cancelled.", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function yieldToWorkerEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

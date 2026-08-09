import type { BuildingDataset, PreparedBuilding } from "./dataset-types.js";
import type {
  EvaluatedBuildingClaim,
  EvaluatedSubproblem,
  EvaluationOptions,
} from "./evaluation-types.js";
import {
  computeRadialSweepVisibility,
  computeRadialSweepVisibilityAsync,
  type SweepVisibleIntervals,
} from "./radial-sweep.js";
import type { SolutionWarning } from "./solution-types.js";
import type { ValidatedAntenna, ValidatedSubproblemInput } from "./submission-types.js";
import {
  createBuildingVisibilityFromIntervals,
  unionParameterIntervals,
} from "./visibility-engine.js";
import type { BuildingVisibility, ParameterInterval } from "./visibility-types.js";

interface PendingBuilding {
  readonly building: PreparedBuilding;
  readonly requiredVisibleLengthMeters: number;
  readonly edgeIntervals: ParameterInterval[][];
  processedAntennaCount: number;
}

interface EvaluationState {
  readonly configurationCache?: Map<string, BuildingVisibility>;
  readonly pendingByBuildingIndex: Map<number, PendingBuilding>;
  readonly visibilityByBuildingId: Map<string, BuildingVisibility>;
  readonly numericalFailures: Map<string, string>;
}

export function evaluateValidatedSubproblem(
  dataset: BuildingDataset,
  input: ValidatedSubproblemInput,
  options: EvaluationOptions = {},
): EvaluatedSubproblem {
  const invalidResult = createInvalidResult(input);
  if (invalidResult !== undefined) return invalidResult;

  const state = initializeEvaluationState(dataset, input, options);
  const antennas = orderAntennasForTargets(input.uniqueAntennas, state.pendingByBuildingIndex);

  for (const [antennaIndex, antenna] of antennas.entries()) {
    throwIfAborted(options.signal);
    if (state.pendingByBuildingIndex.size === 0) break;
    try {
      const swept = computeRadialSweepVisibility(
        dataset,
        antenna.evaluatedCoordinate,
        new Set(state.pendingByBuildingIndex.keys()),
        options.signal,
      );
      applyAntennaSweep(state, swept, antennaIndex + 1, antennas.length, options);
      options.onAntennaProgress?.({
        subproblemIndex: input.source.index,
        completedAntennaCount: antennaIndex + 1,
        totalAntennaCount: antennas.length,
        remainingBuildingCount: state.pendingByBuildingIndex.size,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      failPendingBuildings(state, error);
      break;
    }
  }

  finalizePendingBuildings(state, antennas.length);
  return buildEvaluatedSubproblem(input, state, options);
}

export async function evaluateValidatedSubproblemAsync(
  dataset: BuildingDataset,
  input: ValidatedSubproblemInput,
  options: EvaluationOptions = {},
): Promise<EvaluatedSubproblem> {
  const invalidResult = createInvalidResult(input);
  if (invalidResult !== undefined) return invalidResult;

  const state = initializeEvaluationState(dataset, input, options);
  const antennas = orderAntennasForTargets(input.uniqueAntennas, state.pendingByBuildingIndex);

  for (const [antennaIndex, antenna] of antennas.entries()) {
    await yieldToWorkerEventLoop();
    throwIfAborted(options.signal);
    if (state.pendingByBuildingIndex.size === 0) break;
    try {
      const swept = await computeRadialSweepVisibilityAsync(
        dataset,
        antenna.evaluatedCoordinate,
        new Set(state.pendingByBuildingIndex.keys()),
        options.signal,
      );
      applyAntennaSweep(state, swept, antennaIndex + 1, antennas.length, options);
      options.onAntennaProgress?.({
        subproblemIndex: input.source.index,
        completedAntennaCount: antennaIndex + 1,
        totalAntennaCount: antennas.length,
        remainingBuildingCount: state.pendingByBuildingIndex.size,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      failPendingBuildings(state, error);
      break;
    }
  }

  finalizePendingBuildings(state, antennas.length);
  return buildEvaluatedSubproblem(input, state, options);
}

function createInvalidResult(input: ValidatedSubproblemInput): EvaluatedSubproblem | undefined {
  if (
    input.source.complete
    && input.source.parametersValid
    && input.source.tau !== undefined
  ) {
    return undefined;
  }
  return {
    input,
    buildingResults: [],
    verifiedBuildingIds: [],
    verifiedServiceScore: 0,
    warnings: [...input.warnings],
  };
}

function initializeEvaluationState(
  dataset: BuildingDataset,
  input: ValidatedSubproblemInput,
  options: EvaluationOptions,
): EvaluationState {
  const configurationCache = getConfigurationCache(input, options);
  const pendingByBuildingIndex = new Map<number, PendingBuilding>();
  const visibilityByBuildingId = new Map<string, BuildingVisibility>();
  const numericalFailures = new Map<string, string>();
  const tau = input.source.tau;
  if (tau === undefined) throw new Error("Validated subproblem unexpectedly has no tau value.");

  for (const buildingId of input.claims.uniqueKnownIds) {
    options.onBuildingEvaluation?.(buildingId);
    const cached = configurationCache?.get(buildingId);
    if (cached !== undefined) {
      visibilityByBuildingId.set(buildingId, cached);
      continue;
    }
    const building = dataset.buildingById.get(buildingId);
    if (building === undefined) {
      numericalFailures.set(buildingId, "Validated building is missing from the dataset.");
      continue;
    }
    pendingByBuildingIndex.set(building.inputIndex, {
      building,
      requiredVisibleLengthMeters: tau * building.perimeterMeters,
      edgeIntervals: building.edges.map(() => []),
      processedAntennaCount: 0,
    });
  }

  return {
    configurationCache,
    pendingByBuildingIndex,
    visibilityByBuildingId,
    numericalFailures,
  };
}

function applyAntennaSweep(
  state: EvaluationState,
  swept: SweepVisibleIntervals,
  processedAntennaCount: number,
  totalAntennaCount: number,
  options: EvaluationOptions,
): void {
  for (const [buildingIndex, pending] of [...state.pendingByBuildingIndex]) {
    const buildingSweep = swept.get(buildingIndex);
    if (buildingSweep !== undefined) {
      for (const [edgeIndex, intervals] of buildingSweep) {
        const existing = pending.edgeIntervals[edgeIndex];
        if (existing !== undefined) {
          pending.edgeIntervals[edgeIndex] = unionParameterIntervals(existing, intervals);
        }
      }
    }
    pending.processedAntennaCount = processedAntennaCount;
    const visibility = createBuildingVisibilityFromIntervals(
      pending.building,
      pending.edgeIntervals,
      processedAntennaCount < totalAntennaCount ? "lower-bound" : "complete",
      processedAntennaCount,
    );
    if (
      !options.fullDiagnosticCoverage
      && visibility.visibleLengthMeters >= pending.requiredVisibleLengthMeters
    ) {
      state.visibilityByBuildingId.set(pending.building.id, visibility);
      state.configurationCache?.set(pending.building.id, visibility);
      state.pendingByBuildingIndex.delete(buildingIndex);
    }
  }
}

function finalizePendingBuildings(state: EvaluationState, totalAntennaCount: number): void {
  for (const [buildingIndex, pending] of state.pendingByBuildingIndex) {
    const visibility = createBuildingVisibilityFromIntervals(
      pending.building,
      pending.edgeIntervals,
      "complete",
      Math.min(pending.processedAntennaCount, totalAntennaCount),
    );
    state.visibilityByBuildingId.set(pending.building.id, visibility);
    state.configurationCache?.set(pending.building.id, visibility);
    state.pendingByBuildingIndex.delete(buildingIndex);
  }
}

function failPendingBuildings(state: EvaluationState, error: unknown): void {
  const message = error instanceof Error ? error.message : "unknown geometry failure";
  for (const [buildingIndex, pending] of state.pendingByBuildingIndex) {
    state.numericalFailures.set(pending.building.id, message);
    state.pendingByBuildingIndex.delete(buildingIndex);
  }
}

function buildEvaluatedSubproblem(
  input: ValidatedSubproblemInput,
  state: EvaluationState,
  options: EvaluationOptions,
): EvaluatedSubproblem {
  const warnings: SolutionWarning[] = [...input.warnings];
  const buildingResults: EvaluatedBuildingClaim[] = [];
  const verifiedBuildingIds: string[] = [];
  const tau = input.source.tau;
  if (tau === undefined) throw new Error("Validated subproblem unexpectedly has no tau value.");

  for (const [buildingIndex, buildingId] of input.claims.uniqueKnownIds.entries()) {
    const failure = state.numericalFailures.get(buildingId);
    if (failure !== undefined) {
      warnings.push({
        code: "NUMERICAL_FAILURE",
        subproblemIndex: input.source.index,
        buildingId,
        message: `Building ${JSON.stringify(buildingId)} could not be evaluated: ${failure}`,
        action: "Exclude this building from the verified service score.",
      });
    } else {
      const visibility = state.visibilityByBuildingId.get(buildingId);
      if (visibility !== undefined) {
        const requiredVisibleLengthMeters = tau * visibility.perimeterMeters;
        const verified = visibility.visibleLengthMeters >= requiredVisibleLengthMeters;
        buildingResults.push({
          buildingId,
          verified,
          coverageKind: visibility.coverageKind,
          coverage: visibility.coverage,
          visibleLengthMeters: visibility.visibleLengthMeters,
          requiredVisibleLengthMeters,
          visibility,
        });
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
      }
    }

    options.onProgress?.({
      subproblemIndex: input.source.index,
      buildingId,
      completedBuildingCount: buildingIndex + 1,
      totalBuildingCount: input.claims.uniqueKnownIds.length,
    });
    throwIfAborted(options.signal);
  }

  return {
    input,
    buildingResults,
    verifiedBuildingIds,
    verifiedServiceScore: verifiedBuildingIds.length,
    warnings,
  };
}

function orderAntennasForTargets(
  antennas: readonly ValidatedAntenna[],
  pendingByBuildingIndex: ReadonlyMap<number, PendingBuilding>,
): ValidatedAntenna[] {
  if (pendingByBuildingIndex.size === 0) return [...antennas];
  let centerX = 0;
  let centerY = 0;
  for (const pending of pendingByBuildingIndex.values()) {
    centerX += (pending.building.extent.xmin + pending.building.extent.xmax) / 2;
    centerY += (pending.building.extent.ymin + pending.building.extent.ymax) / 2;
  }
  centerX /= pendingByBuildingIndex.size;
  centerY /= pendingByBuildingIndex.size;

  return [...antennas].sort((left, right) => {
    const leftDistance = Math.hypot(
      left.evaluatedCoordinate[0] - centerX,
      left.evaluatedCoordinate[1] - centerY,
    );
    const rightDistance = Math.hypot(
      right.evaluatedCoordinate[0] - centerX,
      right.evaluatedCoordinate[1] - centerY,
    );
    return leftDistance - rightDistance || left.inputIndex - right.inputIndex;
  });
}

function getConfigurationCache(
  input: ValidatedSubproblemInput,
  options: EvaluationOptions,
): Map<string, BuildingVisibility> | undefined {
  const cache = options.visibilityCache;
  if (cache === undefined) return undefined;
  const thresholdKey = options.fullDiagnosticCoverage ? "full" : `tau:${input.source.tau}`;
  const antennaKey = input.uniqueAntennas
    .map((antenna) => `${antenna.evaluatedCoordinate[0]},${antenna.evaluatedCoordinate[1]}`)
    .join(";");
  const key = `${thresholdKey}|${antennaKey}`;
  let configuration = cache.byConfiguration.get(key);
  if (configuration === undefined) {
    configuration = new Map();
    cache.byConfiguration.set(key, configuration);
  }
  return configuration;
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

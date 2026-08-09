import type { Coordinate } from "./dataset-types.js";
import type { ParsedSubproblem, SolutionWarning } from "./solution-types.js";

export interface ValidatedAntenna {
  readonly inputIndex: number;
  readonly submittedCoordinate: Coordinate;
  readonly evaluatedCoordinate: Coordinate;
  readonly boundaryDistanceMeters: number;
  readonly hostBuildingId: string;
  readonly snapped: boolean;
  readonly duplicateOfInputIndex?: number;
}

export interface ClaimResolution {
  readonly reportedIds: readonly string[];
  readonly uniqueKnownIds: readonly string[];
  readonly unknownIds: readonly string[];
  readonly duplicateIds: readonly string[];
}

export interface ValidatedSubproblemInput {
  readonly source: ParsedSubproblem;
  readonly validAntennas: readonly ValidatedAntenna[];
  readonly uniqueAntennas: readonly ValidatedAntenna[];
  readonly invalidRetainedAntennaCount: number;
  readonly claims: ClaimResolution;
  readonly warnings: readonly SolutionWarning[];
}


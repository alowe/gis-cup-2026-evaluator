import type { Coordinate } from "./dataset-types.js";

export type SolutionWarningCode =
  | "INCOMPLETE_SUBPROBLEM"
  | "INVALID_TAU"
  | "INVALID_K"
  | "EXTRA_ANTENNAS"
  | "MALFORMED_ANTENNA"
  | "NONFINITE_ANTENNA"
  | "EMPTY_BUILDING_ID"
  | "ANTENNA_OFF_BOUNDARY"
  | "ANTENNA_SNAPPED"
  | "DUPLICATE_ANTENNA"
  | "UNKNOWN_BUILDING_ID"
  | "DUPLICATE_BUILDING_ID"
  | "CLAIM_BELOW_THRESHOLD"
  | "NUMERICAL_FAILURE";

export interface SolutionWarning {
  readonly code: SolutionWarningCode;
  readonly subproblemIndex: number;
  readonly entryIndex?: number;
  readonly buildingId?: string;
  readonly message: string;
  readonly action: string;
}

export type ParsedAntennaEntry =
  | {
      readonly inputIndex: number;
      readonly raw: string;
      readonly status: "valid";
      readonly coordinate: Coordinate;
    }
  | {
      readonly inputIndex: number;
      readonly raw: string;
      readonly status: "malformed" | "nonfinite";
    };

export interface ParsedSubproblem {
  readonly index: number;
  readonly complete: boolean;
  readonly tau?: number;
  readonly k?: number;
  readonly parametersValid: boolean;
  readonly antennas: readonly ParsedAntennaEntry[];
  readonly retainedAntennas: readonly ParsedAntennaEntry[];
  readonly claimedBuildingIds: readonly string[];
  readonly warnings: readonly SolutionWarning[];
}

export interface ParsedSolution {
  readonly subproblems: readonly ParsedSubproblem[];
  readonly warnings: readonly SolutionWarning[];
}

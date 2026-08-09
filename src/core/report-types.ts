import type { SolutionWarning } from "./solution-types.js";

export interface EvaluationReport {
  readonly schemaVersion: "1.0";
  readonly evaluatorVersion: string;
  readonly arcgisVersion: string;
  readonly spatialToleranceMeters: number;
  readonly generatedAt: string;
  readonly dataset: {
    readonly fileName: string;
    readonly sha256: string;
    readonly spatialReference: number;
    readonly buildingCount: number;
    readonly edgeCount: number;
    readonly vertexCount: number;
  };
  readonly solution: {
    readonly fileName: string;
    readonly sha256: string;
  };
  readonly fullDiagnosticCoverage: boolean;
  readonly subproblems: readonly ReportSubproblem[];
}

export interface ReportSubproblem {
  readonly index: number;
  readonly complete: boolean;
  readonly parameters: {
    readonly tau?: number;
    readonly k?: number;
    readonly valid: boolean;
  };
  readonly antennas: {
    readonly reported: number;
    readonly retainedByK: number;
    readonly valid: number;
    readonly unique: number;
    readonly invalid: number;
    readonly truncated: number;
  };
  readonly claims: {
    readonly reported: number;
    readonly uniqueKnown: number;
    readonly unknown: number;
    readonly duplicate: number;
    readonly verified: number;
  };
  readonly verifiedServiceScore: number;
  readonly verifiedBuildingIds: readonly string[];
  readonly buildingResults: readonly ReportBuildingResult[];
  readonly warnings: readonly SolutionWarning[];
}

export interface ReportBuildingResult {
  readonly buildingId: string;
  readonly verified: boolean;
  readonly coverageKind: "complete" | "lower-bound";
  readonly coverage?: number;
  readonly coverageLowerBound?: number;
  readonly visibleLengthMeters: number;
  readonly requiredVisibleLengthMeters: number;
  readonly processedAntennaCount: number;
}


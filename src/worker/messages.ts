import type { EvaluationReport } from "../core/report-types.js";

export type EvaluatorWorkerRequest =
  | {
      readonly type: "ping";
    }
  | {
      readonly type: "load-dataset";
      readonly requestId: number;
      readonly file: File;
    }
  | {
      readonly type: "cancel-evaluation";
      readonly requestId: number;
    }
  | {
      readonly type: "load-solution";
      readonly requestId: number;
      readonly file: File;
      readonly fullDiagnosticCoverage: boolean;
    };

export type EvaluatorWorkerResponse =
  | {
      readonly type: "ready";
      readonly spatialToleranceMeters: number;
    }
  | {
      readonly type: "dataset-loaded";
      readonly requestId: number;
      readonly summary: DatasetSummary;
    }
  | {
      readonly type: "dataset-error";
      readonly requestId: number;
      readonly error: WorkerError;
    }
  | {
      readonly type: "solution-validated";
      readonly requestId: number;
      readonly summary: SolutionValidationSummary;
      readonly report: EvaluationReport;
    }
  | {
      readonly type: "solution-error";
      readonly requestId: number;
      readonly error: WorkerError;
    }
  | {
      readonly type: "evaluation-progress";
      readonly requestId: number;
      readonly subproblemIndex: number;
      readonly buildingId: string;
      readonly completedBuildingCount: number;
      readonly totalBuildingCount: number;
    };

export interface DatasetSummary {
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly spatialReferenceWkid: number;
  readonly buildingCount: number;
  readonly edgeCount: number;
  readonly vertexCount: number;
  readonly sha256: string;
}

export interface WorkerError {
  readonly code: string;
  readonly message: string;
  readonly featureIndex?: number;
  readonly buildingId?: string;
}

export interface SolutionValidationSummary {
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly subproblems: readonly SubproblemValidationSummary[];
  readonly warningCount: number;
}

export interface SubproblemValidationSummary {
  readonly index: number;
  readonly complete: boolean;
  readonly parametersValid: boolean;
  readonly tau?: number;
  readonly k?: number;
  readonly reportedAntennaCount: number;
  readonly retainedAntennaCount: number;
  readonly validAntennaCount: number;
  readonly uniqueAntennaCount: number;
  readonly reportedClaimCount: number;
  readonly uniqueKnownClaimCount: number;
  readonly verifiedServiceScore: number;
  readonly warningCount: number;
}

export type EvaluatorWorkerRequest =
  | {
      readonly type: "ping";
    }
  | {
      readonly type: "load-dataset";
      readonly requestId: number;
      readonly file: File;
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
    };

export interface DatasetSummary {
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly spatialReferenceWkid: number;
  readonly buildingCount: number;
  readonly edgeCount: number;
  readonly vertexCount: number;
}

export interface WorkerError {
  readonly code: string;
  readonly message: string;
  readonly featureIndex?: number;
  readonly buildingId?: string;
}

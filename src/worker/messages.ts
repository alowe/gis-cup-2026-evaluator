export type EvaluatorWorkerRequest = {
  readonly type: "ping";
};

export type EvaluatorWorkerResponse = {
  readonly type: "ready";
  readonly spatialToleranceMeters: number;
};

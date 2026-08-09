/// <reference lib="webworker" />

import type { EvaluatorWorkerRequest, EvaluatorWorkerResponse } from "./messages.js";
import { SPATIAL_TOLERANCE_METERS, TEST_SPATIAL_REFERENCE_WKID } from "../core/constants.js";
import { createMeterSpatialReference } from "../core/spatial-reference.js";

const worker = self as DedicatedWorkerGlobalScope;
const spatialReference = createMeterSpatialReference(TEST_SPATIAL_REFERENCE_WKID);

worker.addEventListener("message", (event: MessageEvent<EvaluatorWorkerRequest>) => {
  if (event.data.type === "ping") {
    const response: EvaluatorWorkerResponse = {
      type: "ready",
      spatialToleranceMeters: spatialReference.xyTolerance ?? SPATIAL_TOLERANCE_METERS,
    };
    worker.postMessage(response);
  }
});

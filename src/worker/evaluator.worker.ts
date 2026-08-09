/// <reference lib="webworker" />

import type { EvaluatorWorkerRequest, EvaluatorWorkerResponse } from "./messages.js";
import { SPATIAL_TOLERANCE_METERS, TEST_SPATIAL_REFERENCE_WKID } from "../core/constants.js";
import { DatasetValidationError } from "../core/dataset-errors.js";
import { parseBuildingDatasetText } from "../core/dataset-loader.js";
import type { BuildingDataset } from "../core/dataset-types.js";
import { createMeterSpatialReference } from "../core/spatial-reference.js";

const worker = self as DedicatedWorkerGlobalScope;
const spatialReference = createMeterSpatialReference(TEST_SPATIAL_REFERENCE_WKID);
let activeDataset: BuildingDataset | undefined;

worker.addEventListener("message", (event: MessageEvent<EvaluatorWorkerRequest>) => {
  switch (event.data.type) {
    case "ping": {
      const response: EvaluatorWorkerResponse = {
        type: "ready",
        spatialToleranceMeters: spatialReference.xyTolerance ?? SPATIAL_TOLERANCE_METERS,
      };
      worker.postMessage(response);
      break;
    }
    case "load-dataset":
      void loadDataset(event.data.requestId, event.data.file);
      break;
  }
});

async function loadDataset(requestId: number, file: File): Promise<void> {
  try {
    activeDataset = parseBuildingDatasetText(await file.text());
    const response: EvaluatorWorkerResponse = {
      type: "dataset-loaded",
      requestId,
      summary: {
        fileName: file.name,
        fileSizeBytes: file.size,
        spatialReferenceWkid: activeDataset.spatialReferenceWkid,
        buildingCount: activeDataset.buildings.length,
        edgeCount: activeDataset.edgeCount,
        vertexCount: activeDataset.vertexCount,
      },
    };
    worker.postMessage(response);
  } catch (error: unknown) {
    const detail = error instanceof DatasetValidationError
      ? {
          code: error.code,
          message: error.message,
          featureIndex: error.featureIndex,
          buildingId: error.buildingId,
        }
      : {
          code: "DATASET_LOAD_FAILED",
          message: error instanceof Error ? error.message : "Dataset loading failed unexpectedly.",
        };
    const response: EvaluatorWorkerResponse = {
      type: "dataset-error",
      requestId,
      error: detail,
    };
    worker.postMessage(response);
  }
}

/// <reference lib="webworker" />

import type { EvaluatorWorkerRequest, EvaluatorWorkerResponse } from "./messages.js";
import { SPATIAL_TOLERANCE_METERS, TEST_SPATIAL_REFERENCE_WKID } from "../core/constants.js";
import { DatasetValidationError } from "../core/dataset-errors.js";
import { parseBuildingDatasetText } from "../core/dataset-loader.js";
import type { BuildingDataset } from "../core/dataset-types.js";
import { evaluateValidatedSubproblem } from "../core/evaluation-engine.js";
import { parseSolutionText } from "../core/solution-parser.js";
import { createMeterSpatialReference } from "../core/spatial-reference.js";
import { validateSubproblemInput } from "../core/submission-validator.js";

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
    case "load-solution":
      void loadSolution(event.data.requestId, event.data.file);
      break;
  }
});

async function loadDataset(requestId: number, file: File): Promise<void> {
  activeDataset = undefined;

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

async function loadSolution(requestId: number, file: File): Promise<void> {
  const dataset = activeDataset;
  if (dataset === undefined) {
    postSolutionError(requestId, {
      code: "DATASET_REQUIRED",
      message: "Load a valid building dataset before loading a solution.",
    });
    return;
  }

  try {
    const parsed = parseSolutionText(await file.text());
    const validated = parsed.subproblems.map((subproblem) =>
      validateSubproblemInput(subproblem, dataset));
    const evaluated = validated.map((subproblem) =>
      evaluateValidatedSubproblem(dataset, subproblem));
    const response: EvaluatorWorkerResponse = {
      type: "solution-validated",
      requestId,
      summary: {
        fileName: file.name,
        fileSizeBytes: file.size,
        warningCount: evaluated.reduce((total, subproblem) => total + subproblem.warnings.length, 0),
        subproblems: evaluated.map((subproblem) => ({
          index: subproblem.input.source.index,
          complete: subproblem.input.source.complete,
          parametersValid: subproblem.input.source.parametersValid,
          tau: subproblem.input.source.tau,
          k: subproblem.input.source.k,
          reportedAntennaCount: subproblem.input.source.antennas.length,
          retainedAntennaCount: subproblem.input.source.retainedAntennas.length,
          validAntennaCount: subproblem.input.validAntennas.length,
          uniqueAntennaCount: subproblem.input.uniqueAntennas.length,
          reportedClaimCount: subproblem.input.claims.reportedIds.length,
          uniqueKnownClaimCount: subproblem.input.claims.uniqueKnownIds.length,
          verifiedServiceScore: subproblem.verifiedServiceScore,
          warningCount: subproblem.warnings.length,
        })),
      },
    };
    worker.postMessage(response);
  } catch (error: unknown) {
    postSolutionError(requestId, {
      code: "SOLUTION_LOAD_FAILED",
      message: error instanceof Error ? error.message : "Solution loading failed unexpectedly.",
    });
  }
}

function postSolutionError(
  requestId: number,
  error: { readonly code: string; readonly message: string },
): void {
  const response: EvaluatorWorkerResponse = {
    type: "solution-error",
    requestId,
    error,
  };
  worker.postMessage(response);
}

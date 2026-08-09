/// <reference lib="webworker" />

import type { EvaluatorWorkerRequest, EvaluatorWorkerResponse } from "./messages.js";
import { SPATIAL_TOLERANCE_METERS, TEST_SPATIAL_REFERENCE_WKID } from "../core/constants.js";
import { DatasetValidationError } from "../core/dataset-errors.js";
import { parseBuildingDatasetText } from "../core/dataset-loader.js";
import type { BuildingDataset } from "../core/dataset-types.js";
import { evaluateValidatedSubproblemAsync } from "../core/evaluation-engine.js";
import type { EvaluatedSubproblem } from "../core/evaluation-types.js";
import type { EvaluationVisibilityCache } from "../core/evaluation-types.js";
import { sha256Hex } from "../core/hash.js";
import { parseSolutionText } from "../core/solution-parser.js";
import { buildEvaluationReport, type ReportInputMetadata } from "../core/report-builder.js";
import { createMeterSpatialReference } from "../core/spatial-reference.js";
import { validateSubproblemInput } from "../core/submission-validator.js";

const worker = self as DedicatedWorkerGlobalScope;
const spatialReference = createMeterSpatialReference(TEST_SPATIAL_REFERENCE_WKID);
let activeDataset: BuildingDataset | undefined;
let activeDatasetInput: ReportInputMetadata | undefined;
let activeEvaluation: { readonly requestId: number; readonly controller: AbortController } | undefined;

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
      void loadSolution(
        event.data.requestId,
        event.data.file,
        event.data.fullDiagnosticCoverage,
      );
      break;
    case "cancel-evaluation":
      if (activeEvaluation?.requestId === event.data.requestId) {
        activeEvaluation.controller.abort(new DOMException("Evaluation cancelled.", "AbortError"));
      }
      break;
  }
});

async function loadDataset(requestId: number, file: File): Promise<void> {
  activeEvaluation?.controller.abort(new DOMException("Dataset changed.", "AbortError"));
  activeDataset = undefined;
  activeDatasetInput = undefined;

  try {
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const sha256 = await sha256Hex(bytes);
    activeDataset = parseBuildingDatasetText(text);
    activeDatasetInput = { fileName: file.name, sha256 };
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
        sha256,
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

async function loadSolution(
  requestId: number,
  file: File,
  fullDiagnosticCoverage: boolean,
): Promise<void> {
  const dataset = activeDataset;
  const datasetInput = activeDatasetInput;
  if (dataset === undefined || datasetInput === undefined) {
    postSolutionError(requestId, {
      code: "DATASET_REQUIRED",
      message: "Load a valid building dataset before loading a solution.",
    });
    return;
  }

  activeEvaluation?.controller.abort(new DOMException("A newer evaluation started.", "AbortError"));
  const controller = new AbortController();
  activeEvaluation = { requestId, controller };

  try {
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const solutionInput = { fileName: file.name, sha256: await sha256Hex(bytes) };
    const parsed = parseSolutionText(text);
    const validated = parsed.subproblems.map((subproblem) =>
      validateSubproblemInput(subproblem, dataset));
    const evaluated: EvaluatedSubproblem[] = [];
    const visibilityCache: EvaluationVisibilityCache = { byConfiguration: new Map() };

    for (const subproblem of validated) {
      evaluated.push(await evaluateValidatedSubproblemAsync(dataset, subproblem, {
        fullDiagnosticCoverage,
        signal: controller.signal,
        visibilityCache,
        onAntennaProgress: (progress) => {
          const response: EvaluatorWorkerResponse = {
            type: "evaluation-antenna-progress",
            requestId,
            ...progress,
          };
          worker.postMessage(response);
        },
        onProgress: (progress) => {
          const response: EvaluatorWorkerResponse = {
            type: "evaluation-progress",
            requestId,
            ...progress,
          };
          worker.postMessage(response);
        },
      }));
    }

    const report = buildEvaluationReport(
      dataset,
      datasetInput,
      solutionInput,
      evaluated,
      fullDiagnosticCoverage,
    );
    const response: EvaluatorWorkerResponse = {
      type: "solution-validated",
      requestId,
      report,
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
    const cancelled = error instanceof DOMException && error.name === "AbortError";
    postSolutionError(requestId, {
      code: cancelled ? "EVALUATION_CANCELLED" : "SOLUTION_LOAD_FAILED",
      message: error instanceof Error ? error.message : "Solution loading failed unexpectedly.",
    });
  } finally {
    if (activeEvaluation?.requestId === requestId) activeEvaluation = undefined;
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

import {
  ARCGIS_VERSION,
  EVALUATOR_VERSION,
  SPATIAL_TOLERANCE_METERS,
} from "./constants.js";
import type { BuildingDataset } from "./dataset-types.js";
import type { EvaluatedSubproblem } from "./evaluation-types.js";
import type { EvaluationReport, ReportBuildingResult } from "./report-types.js";

export interface ReportInputMetadata {
  readonly fileName: string;
  readonly sha256: string;
}

export function buildEvaluationReport(
  dataset: BuildingDataset,
  datasetInput: ReportInputMetadata,
  solutionInput: ReportInputMetadata,
  subproblems: readonly EvaluatedSubproblem[],
  fullDiagnosticCoverage: boolean,
  generatedAt = new Date(),
): EvaluationReport {
  return {
    schemaVersion: "1.0",
    evaluatorVersion: EVALUATOR_VERSION,
    arcgisVersion: ARCGIS_VERSION,
    spatialToleranceMeters: SPATIAL_TOLERANCE_METERS,
    generatedAt: generatedAt.toISOString(),
    dataset: {
      fileName: datasetInput.fileName,
      sha256: datasetInput.sha256,
      spatialReference: dataset.spatialReferenceWkid,
      buildingCount: dataset.buildings.length,
      edgeCount: dataset.edgeCount,
      vertexCount: dataset.vertexCount,
    },
    solution: solutionInput,
    fullDiagnosticCoverage,
    subproblems: subproblems.map((subproblem) => ({
      index: subproblem.input.source.index,
      complete: subproblem.input.source.complete,
      parameters: {
        tau: subproblem.input.source.tau,
        k: subproblem.input.source.k,
        valid: subproblem.input.source.parametersValid,
      },
      antennas: {
        reported: subproblem.input.source.antennas.length,
        retainedByK: subproblem.input.source.retainedAntennas.length,
        valid: subproblem.input.validAntennas.length,
        unique: subproblem.input.uniqueAntennas.length,
        invalid: subproblem.input.invalidRetainedAntennaCount,
        truncated: Math.max(
          0,
          subproblem.input.source.antennas.length
            - subproblem.input.source.retainedAntennas.length,
        ),
      },
      claims: {
        reported: subproblem.input.claims.reportedIds.length,
        uniqueKnown: subproblem.input.claims.uniqueKnownIds.length,
        unknown: subproblem.input.claims.unknownIds.length,
        duplicate: subproblem.input.claims.duplicateIds.length,
        verified: subproblem.verifiedServiceScore,
      },
      verifiedServiceScore: subproblem.verifiedServiceScore,
      verifiedBuildingIds: subproblem.verifiedBuildingIds,
      buildingResults: subproblem.buildingResults.map(toReportBuildingResult),
      warnings: subproblem.warnings,
    })),
  };
}

function toReportBuildingResult(
  result: EvaluatedSubproblem["buildingResults"][number],
): ReportBuildingResult {
  return {
    buildingId: result.buildingId,
    verified: result.verified,
    coverageKind: result.coverageKind,
    coverage: result.coverageKind === "complete" ? result.coverage : undefined,
    coverageLowerBound: result.coverageKind === "lower-bound" ? result.coverage : undefined,
    visibleLengthMeters: result.visibleLengthMeters,
    requiredVisibleLengthMeters: result.requiredVisibleLengthMeters,
    processedAntennaCount: result.visibility.processedAntennaCount,
  };
}


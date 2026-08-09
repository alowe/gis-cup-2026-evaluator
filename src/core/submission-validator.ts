import Point from "@arcgis/core/geometry/Point.js";
import * as proximityOperator from "@arcgis/core/geometry/operators/proximityOperator.js";

import {
  DISTANCE_TIE_TOLERANCE_METERS,
  SPATIAL_TOLERANCE_METERS,
} from "./constants.js";
import type { BuildingDataset, Coordinate, PreparedBuilding } from "./dataset-types.js";
import type { ParsedAntennaEntry, ParsedSubproblem, SolutionWarning } from "./solution-types.js";
import type {
  ClaimResolution,
  ValidatedAntenna,
  ValidatedSubproblemInput,
} from "./submission-types.js";

interface SnapCandidate {
  readonly building: PreparedBuilding;
  readonly coordinate: Coordinate;
  readonly distanceMeters: number;
}

export function validateSubproblemInput(
  subproblem: ParsedSubproblem,
  dataset: BuildingDataset,
): ValidatedSubproblemInput {
  const warnings = [...subproblem.warnings];
  const claims = resolveClaims(subproblem, dataset, warnings);
  const validAntennas: ValidatedAntenna[] = [];
  const uniqueAntennas: ValidatedAntenna[] = [];
  const firstAntennaByCoordinate = new Map<string, ValidatedAntenna>();
  let invalidRetainedAntennaCount = 0;

  if (subproblem.parametersValid) {
    for (const entry of subproblem.retainedAntennas) {
      if (entry.status !== "valid") {
        invalidRetainedAntennaCount += 1;
        continue;
      }

      const candidate = snapAntenna(entry, dataset);
      if (candidate === undefined) {
        invalidRetainedAntennaCount += 1;
        warnings.push({
          code: "ANTENNA_OFF_BOUNDARY",
          subproblemIndex: subproblem.index,
          entryIndex: entry.inputIndex,
          message: `Antenna entry ${entry.inputIndex} is more than ${SPATIAL_TOLERANCE_METERS} m from every building boundary.`,
          action: "Exclude this retained entry from visibility evaluation.",
        });
        continue;
      }

      const snapped = !coordinatesEqual(entry.coordinate, candidate.coordinate);
      const coordinateKey = makeCoordinateKey(candidate.coordinate);
      const duplicate = firstAntennaByCoordinate.get(coordinateKey);
      const antenna: ValidatedAntenna = {
        inputIndex: entry.inputIndex,
        submittedCoordinate: entry.coordinate,
        evaluatedCoordinate: candidate.coordinate,
        boundaryDistanceMeters: candidate.distanceMeters,
        hostBuildingId: candidate.building.id,
        snapped,
        duplicateOfInputIndex: duplicate?.inputIndex,
      };

      validAntennas.push(antenna);

      if (duplicate === undefined) {
        firstAntennaByCoordinate.set(coordinateKey, antenna);
        uniqueAntennas.push(antenna);
      } else {
        warnings.push({
          code: "DUPLICATE_ANTENNA",
          subproblemIndex: subproblem.index,
          entryIndex: entry.inputIndex,
          message: `Antenna entry ${entry.inputIndex} snaps to the same coordinate as entry ${duplicate.inputIndex}.`,
          action: "Count the entry toward k but reuse the existing visibility result.",
        });
      }

      if (snapped) {
        warnings.push({
          code: "ANTENNA_SNAPPED",
          subproblemIndex: subproblem.index,
          entryIndex: entry.inputIndex,
          message: `Antenna entry ${entry.inputIndex} was snapped ${candidate.distanceMeters} m to building ${JSON.stringify(candidate.building.id)}.`,
          action: "Use the snapped coordinate for all visibility calculations.",
        });
      }
    }
  }

  return {
    source: subproblem,
    validAntennas,
    uniqueAntennas,
    invalidRetainedAntennaCount,
    claims,
    warnings,
  };
}

function snapAntenna(
  entry: Extract<ParsedAntennaEntry, { readonly status: "valid" }>,
  dataset: BuildingDataset,
): SnapCandidate | undefined {
  const [x, y] = entry.coordinate;
  const boundaryItems = dataset.boundaryIndex.search({
    minX: x - SPATIAL_TOLERANCE_METERS,
    minY: y - SPATIAL_TOLERANCE_METERS,
    maxX: x + SPATIAL_TOLERANCE_METERS,
    maxY: y + SPATIAL_TOLERANCE_METERS,
  });
  const candidateIds = new Set(boundaryItems.map((item) => item.buildingId));
  const point = new Point({ x, y, spatialReference: dataset.spatialReference });
  let best: SnapCandidate | undefined;

  for (const buildingId of candidateIds) {
    const building = dataset.buildingById.get(buildingId);
    if (building === undefined) continue;

    const result = proximityOperator.getNearestCoordinate(building.polygon, point, {
      unit: "meters",
      testPolygonInterior: false,
    });

    if (!Number.isFinite(result.distance) || result.distance > SPATIAL_TOLERANCE_METERS) continue;

    const candidate: SnapCandidate = {
      building,
      coordinate: [result.coordinate.x, result.coordinate.y],
      distanceMeters: result.distance,
    };

    if (best === undefined || compareSnapCandidates(candidate, best) < 0) {
      best = candidate;
    }
  }

  return best;
}

function compareSnapCandidates(left: SnapCandidate, right: SnapCandidate): number {
  const distanceDifference = left.distanceMeters - right.distanceMeters;
  if (Math.abs(distanceDifference) > DISTANCE_TIE_TOLERANCE_METERS) {
    return distanceDifference;
  }

  if (left.building.id < right.building.id) return -1;
  if (left.building.id > right.building.id) return 1;
  return left.building.inputIndex - right.building.inputIndex;
}

function resolveClaims(
  subproblem: ParsedSubproblem,
  dataset: BuildingDataset,
  warnings: SolutionWarning[],
): ClaimResolution {
  const uniqueKnownIds: string[] = [];
  const unknownIds: string[] = [];
  const duplicateIds: string[] = [];
  const seen = new Set<string>();

  for (const [arrayIndex, id] of subproblem.claimedBuildingIds.entries()) {
    if (seen.has(id)) {
      duplicateIds.push(id);
      warnings.push({
        code: "DUPLICATE_BUILDING_ID",
        subproblemIndex: subproblem.index,
        entryIndex: arrayIndex + 1,
        message: `Claimed building ID ${JSON.stringify(id)} appears more than once.`,
        action: "Evaluate and count this building at most once.",
      });
      continue;
    }

    seen.add(id);
    if (dataset.buildingById.has(id)) {
      uniqueKnownIds.push(id);
    } else {
      unknownIds.push(id);
      warnings.push({
        code: "UNKNOWN_BUILDING_ID",
        subproblemIndex: subproblem.index,
        entryIndex: arrayIndex + 1,
        message: `Claimed building ID ${JSON.stringify(id)} is not present in the dataset.`,
        action: "Exclude this building from evaluation.",
      });
    }
  }

  return {
    reportedIds: subproblem.claimedBuildingIds,
    uniqueKnownIds,
    unknownIds,
    duplicateIds,
  };
}

function coordinatesEqual(left: Coordinate, right: Coordinate): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function makeCoordinateKey([x, y]: Coordinate): string {
  return `${Object.is(x, -0) ? 0 : x},${Object.is(y, -0) ? 0 : y}`;
}


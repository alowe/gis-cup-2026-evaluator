import Point from "@arcgis/core/geometry/Point.js";

import { SPATIAL_TOLERANCE_METERS } from "./constants.js";
import type { BuildingDataset, BuildingEdge, Coordinate } from "./dataset-types.js";
import { isBlockedByPolygon } from "./line-of-sight.js";
import type { ValidatedAntenna } from "./submission-types.js";
import type {
  BuildingVisibility,
  EdgeVisibility,
  ParameterInterval,
} from "./visibility-types.js";

const PARAMETER_EPSILON = 1e-12;

export function computeBuildingVisibility(
  dataset: BuildingDataset,
  buildingId: string,
  antennas: readonly ValidatedAntenna[],
): BuildingVisibility {
  const building = dataset.buildingById.get(buildingId);
  if (building === undefined) {
    throw new Error(`Unknown target building ID ${JSON.stringify(buildingId)}.`);
  }

  const edges: EdgeVisibility[] = building.edges.map((edge) => {
    let visibleIntervals: ParameterInterval[] = [];

    for (const antenna of antennas) {
      const antennaIntervals = computeVisibleIntervalsForEdge(
        dataset,
        edge,
        antenna.evaluatedCoordinate,
      );
      visibleIntervals = unionParameterIntervals(visibleIntervals, antennaIntervals);
      if (isEntireEdgeVisible(visibleIntervals)) break;
    }

    return {
      edge,
      visibleIntervals,
      visibleLengthMeters: intervalMeasure(visibleIntervals) * edge.lengthMeters,
    };
  });
  const visibleLengthMeters = edges.reduce(
    (total, edge) => total + edge.visibleLengthMeters,
    0,
  );

  return {
    building,
    edges,
    visibleLengthMeters,
    perimeterMeters: building.perimeterMeters,
    coverage: visibleLengthMeters / building.perimeterMeters,
  };
}

export function computeVisibleIntervalsForEdge(
  dataset: BuildingDataset,
  edge: BuildingEdge,
  antenna: Coordinate,
): ParameterInterval[] {
  const breakpoints = generateCriticalParametersForEdge(dataset, edge, antenna);
  const intervals: ParameterInterval[] = [];

  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const start = breakpoints[index];
    const end = breakpoints[index + 1];
    if (start === undefined || end === undefined || end - start <= PARAMETER_EPSILON) continue;

    const midpoint = (start + end) / 2;
    const target = interpolate(edge.start, edge.end, midpoint);
    if (!isSightLineBlocked(dataset, antenna, target)) {
      intervals.push({ start, end });
    }
  }

  return unionParameterIntervals([], intervals);
}

export function isSightLineBlocked(
  dataset: BuildingDataset,
  start: Coordinate,
  end: Coordinate,
): boolean {
  if (coordinatesEqual(start, end)) return false;

  const candidates = dataset.buildingIndex.search({
    minX: Math.min(start[0], end[0]) - SPATIAL_TOLERANCE_METERS,
    minY: Math.min(start[1], end[1]) - SPATIAL_TOLERANCE_METERS,
    maxX: Math.max(start[0], end[0]) + SPATIAL_TOLERANCE_METERS,
    maxY: Math.max(start[1], end[1]) + SPATIAL_TOLERANCE_METERS,
  });
  const candidateIds = [...new Set(candidates.map((candidate) => candidate.buildingId))]
    .sort((left, right) => {
      const leftBuilding = dataset.buildingById.get(left);
      const rightBuilding = dataset.buildingById.get(right);
      return (leftBuilding?.inputIndex ?? 0) - (rightBuilding?.inputIndex ?? 0);
    });
  const startPoint = new Point({
    x: start[0],
    y: start[1],
    spatialReference: dataset.spatialReference,
  });
  const endPoint = new Point({
    x: end[0],
    y: end[1],
    spatialReference: dataset.spatialReference,
  });

  for (const buildingId of candidateIds) {
    const building = dataset.buildingById.get(buildingId);
    if (building !== undefined && isBlockedByPolygon(startPoint, endPoint, building.polygon)) {
      return true;
    }
  }

  return false;
}

export function unionParameterIntervals(
  left: readonly ParameterInterval[],
  right: readonly ParameterInterval[],
): ParameterInterval[] {
  const sorted = [...left, ...right]
    .map((interval) => ({
      start: clampParameter(interval.start),
      end: clampParameter(interval.end),
    }))
    .filter((interval) => interval.end - interval.start > PARAMETER_EPSILON)
    .sort((first, second) => first.start - second.start || first.end - second.end);
  const merged: ParameterInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || interval.start > previous.end + PARAMETER_EPSILON) {
      merged.push(interval);
    } else {
      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, interval.end),
      };
    }
  }

  return merged;
}

export function generateCriticalParametersForEdge(
  dataset: BuildingDataset,
  edge: BuildingEdge,
  antenna: Coordinate,
): number[] {
  const breakpoints = [0, 1];
  const minX = Math.min(antenna[0], edge.start[0], edge.end[0]) - SPATIAL_TOLERANCE_METERS;
  const minY = Math.min(antenna[1], edge.start[1], edge.end[1]) - SPATIAL_TOLERANCE_METERS;
  const maxX = Math.max(antenna[0], edge.start[0], edge.end[0]) + SPATIAL_TOLERANCE_METERS;
  const maxY = Math.max(antenna[1], edge.start[1], edge.end[1]) + SPATIAL_TOLERANCE_METERS;
  const edgeVector = subtract(edge.end, edge.start);
  const edgeLength = Math.hypot(edgeVector[0], edgeVector[1]);

  if (edgeLength === 0) return breakpoints;

  const antennaOffset = subtract(antenna, edge.start);
  const distanceToSupportingLine = Math.abs(cross(edgeVector, antennaOffset)) / edgeLength;
  if (distanceToSupportingLine <= SPATIAL_TOLERANCE_METERS) {
    const projection = dot(antennaOffset, edgeVector) / (edgeLength * edgeLength);
    if (projection > 0 && projection < 1) breakpoints.push(projection);
  }

  const vertices = dataset.vertexIndex.search({ minX, minY, maxX, maxY });
  for (const vertex of vertices) {
    const ray = subtract([vertex.x, vertex.y], antenna);
    if (Math.hypot(ray[0], ray[1]) <= SPATIAL_TOLERANCE_METERS) continue;

    const denominator = cross(ray, edgeVector);
    const denominatorScale = Math.hypot(ray[0], ray[1]) * edgeLength;
    if (Math.abs(denominator) <= Number.EPSILON * 32 * Math.max(1, denominatorScale)) continue;

    const edgeFromAntenna = subtract(edge.start, antenna);
    const rayScale = cross(edgeFromAntenna, edgeVector) / denominator;
    const edgeParameter = cross(edgeFromAntenna, ray) / denominator;

    if (
      rayScale >= 1 - PARAMETER_EPSILON
      && edgeParameter > PARAMETER_EPSILON
      && edgeParameter < 1 - PARAMETER_EPSILON
    ) {
      breakpoints.push(edgeParameter);
    }
  }

  return deduplicateParameters(breakpoints);
}

function deduplicateParameters(values: readonly number[]): number[] {
  const sorted = values
    .map(clampParameter)
    .sort((left, right) => left - right);
  const unique: number[] = [];

  for (const value of sorted) {
    const previous = unique.at(-1);
    if (previous === undefined || Math.abs(value - previous) > PARAMETER_EPSILON) {
      unique.push(value);
    }
  }

  return unique;
}

function intervalMeasure(intervals: readonly ParameterInterval[]): number {
  return intervals.reduce((total, interval) => total + interval.end - interval.start, 0);
}

function isEntireEdgeVisible(intervals: readonly ParameterInterval[]): boolean {
  return intervals.length === 1
    && (intervals[0]?.start ?? 1) <= PARAMETER_EPSILON
    && (intervals[0]?.end ?? 0) >= 1 - PARAMETER_EPSILON;
}

function interpolate(start: Coordinate, end: Coordinate, parameter: number): Coordinate {
  return [
    start[0] + parameter * (end[0] - start[0]),
    start[1] + parameter * (end[1] - start[1]),
  ];
}

function subtract(left: Coordinate, right: Coordinate): Coordinate {
  return [left[0] - right[0], left[1] - right[1]];
}

function cross(left: Coordinate, right: Coordinate): number {
  return left[0] * right[1] - left[1] * right[0];
}

function dot(left: Coordinate, right: Coordinate): number {
  return left[0] * right[0] + left[1] * right[1];
}

function clampParameter(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function coordinatesEqual(left: Coordinate, right: Coordinate): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

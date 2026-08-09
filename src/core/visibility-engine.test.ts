import { describe, expect, it } from "vitest";

import { loadBuildingDataset } from "./dataset-loader.js";
import type { BuildingDataset, Coordinate } from "./dataset-types.js";
import type { ValidatedAntenna } from "./submission-types.js";
import {
  computeBuildingVisibility,
  computeVisibleIntervalsForEdge,
  generateCriticalParametersForEdge,
  isSightLineBlocked,
  unionParameterIntervals,
} from "./visibility-engine.js";

describe("visibility engine", () => {
  it("accounts for self-occlusion from an antenna on a square corner", () => {
    const dataset = datasetFromFeatures([square("target", 500000, 3700000, 1, 1)]);
    const result = computeBuildingVisibility(
      dataset,
      "target",
      [antenna([500000, 3700000], "target")],
    );

    expect(result.visibleLengthMeters).toBeCloseTo(2, 9);
    expect(result.coverage).toBeCloseTo(0.5, 9);
  });

  it("unions complementary antennas without double-counting perimeter", () => {
    const dataset = datasetFromFeatures([square("target", 500000, 3700000, 1, 1)]);
    const result = computeBuildingVisibility(dataset, "target", [
      antenna([500000, 3700000], "target"),
      antenna([500001, 3700001], "target"),
      antenna([500001, 3700001], "target", 3),
    ]);

    expect(result.visibleLengthMeters).toBeCloseTo(4, 9);
    expect(result.coverage).toBeCloseTo(1, 9);
  });

  it("stops safely after reaching a required visible length", () => {
    const dataset = datasetFromFeatures([square("target", 500000, 3700000, 1, 1)]);
    const antennas = [
      antenna([500000, 3700000], "target"),
      antenna([500001, 3700001], "target", 2),
    ];
    const lowerBound = computeBuildingVisibility(dataset, "target", antennas, {
      requiredVisibleLengthMeters: 2,
    });
    const complete = computeBuildingVisibility(dataset, "target", antennas, {
      requiredVisibleLengthMeters: 2,
      fullDiagnosticCoverage: true,
    });

    expect(lowerBound.coverageKind).toBe("lower-bound");
    expect(lowerBound.processedAntennaCount).toBe(1);
    expect(lowerBound.visibleLengthMeters).toBeCloseTo(2, 9);
    expect(complete.coverageKind).toBe("complete");
    expect(complete.processedAntennaCount).toBe(2);
    expect(complete.visibleLengthMeters).toBeCloseTo(4, 9);
  });

  it("creates continuous visible intervals around a partial obstacle shadow", () => {
    const dataset = shadowDataset();
    const target = dataset.buildingById.get("target");
    const leftEdge = target?.edges.find((edge) => edge.start[0] === 500010 && edge.end[0] === 500010);
    if (leftEdge === undefined) throw new Error("Expected target left edge.");

    const intervals = computeVisibleIntervalsForEdge(dataset, leftEdge, [500000, 3700000]);
    const visibleFraction = intervals.reduce(
      (total, interval) => total + interval.end - interval.start,
      0,
    );

    expect(intervals).toHaveLength(2);
    expect(visibleFraction).toBeCloseTo(0.5, 9);
  });

  it("treats vertex tangency as visible and interior crossing as blocked", () => {
    const dataset = shadowDataset();
    const origin: Coordinate = [500000, 3700000];

    expect(isSightLineBlocked(dataset, origin, [500010, 3700000.5])).toBe(false);
    expect(isSightLineBlocked(dataset, origin, [500010, 3700000])).toBe(true);
  });

  it("merges overlapping and touching parameter intervals", () => {
    expect(unionParameterIntervals(
      [{ start: 0, end: 0.4 }, { start: 0.8, end: 1 }],
      [{ start: 0.3, end: 0.8 }],
    )).toEqual([{ start: 0, end: 1 }]);
  });

  it("matches dense direct line-of-sight classifications away from critical points", () => {
    const dataset = datasetFromFeatures([
      square("host", 499999, 3699999, 1, 1),
      square("lower", 500003, 3699999.4, 1, 0.35),
      square("upper", 500005, 3700000.15, 1, 0.3),
      square("center", 500007, 3699999.95, 1, 0.1),
      square("target", 500010, 3699999, 1, 2),
    ]);
    const target = dataset.buildingById.get("target");
    const edge = target?.edges.find((candidate) =>
      candidate.start[0] === 500010 && candidate.end[0] === 500010);
    if (edge === undefined) throw new Error("Expected target left edge.");
    const origin: Coordinate = [500000, 3700000];
    const intervals = computeVisibleIntervalsForEdge(dataset, edge, origin);
    const criticalParameters = generateCriticalParametersForEdge(dataset, edge, origin);
    const mismatches: Array<{ parameter: number; intervalVisible: boolean; directVisible: boolean }> = [];

    for (let index = 0; index < 100; index += 1) {
      const parameter = (index + 0.371) / 100;
      if (criticalParameters.some((critical) => Math.abs(parameter - critical) < 0.005)) {
        continue;
      }
      const targetPoint: Coordinate = [
        edge.start[0] + parameter * (edge.end[0] - edge.start[0]),
        edge.start[1] + parameter * (edge.end[1] - edge.start[1]),
      ];
      const intervalVisible = intervals.some((interval) =>
        parameter > interval.start && parameter < interval.end);

      const directVisible = !isSightLineBlocked(dataset, origin, targetPoint);
      if (intervalVisible !== directVisible) {
        mismatches.push({ parameter, intervalVisible, directVisible });
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("classifies a collinear target edge consistently", () => {
    const dataset = datasetFromFeatures([
      square("host", 499999, 3699999, 1, 1),
      square("obstacle", 500004, 3699999.8, 2, 0.4),
      square("target", 500010, 3700000, 2, 1),
    ]);
    const target = dataset.buildingById.get("target");
    const bottomEdge = target?.edges.find((edge) =>
      edge.start[1] === 3700000 && edge.end[1] === 3700000);
    if (bottomEdge === undefined) throw new Error("Expected target bottom edge.");

    expect(computeVisibleIntervalsForEdge(
      dataset,
      bottomEdge,
      [500000, 3700000],
    )).toEqual([]);
  });
});

function shadowDataset(): BuildingDataset {
  return datasetFromFeatures([
    square("host", 499999, 3699999, 1, 1),
    square("obstacle", 500004, 3699999.8, 2, 0.4),
    square("target", 500010, 3699999, 1, 2),
  ]);
}

function datasetFromFeatures(features: readonly object[]): BuildingDataset {
  return loadBuildingDataset({
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "EPSG:32611" } },
    features,
  });
}

function square(
  id: string,
  xmin: number,
  ymin: number,
  width: number,
  height: number,
): object {
  return {
    type: "Feature",
    properties: { id },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [xmin, ymin],
        [xmin + width, ymin],
        [xmin + width, ymin + height],
        [xmin, ymin + height],
        [xmin, ymin],
      ]],
    },
  };
}

function antenna(
  coordinate: Coordinate,
  hostBuildingId: string,
  inputIndex = 1,
): ValidatedAntenna {
  return {
    inputIndex,
    submittedCoordinate: coordinate,
    evaluatedCoordinate: coordinate,
    boundaryDistanceMeters: 0,
    hostBuildingId,
    snapped: false,
  };
}

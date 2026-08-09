import { describe, expect, it } from "vitest";

import { loadBuildingDataset } from "./dataset-loader.js";
import type { BuildingDataset, Coordinate } from "./dataset-types.js";
import {
  computeRadialSweepVisibility,
  computeRadialSweepVisibilityAsync,
} from "./radial-sweep.js";
import type { ValidatedAntenna } from "./submission-types.js";
import {
  computeBuildingVisibility,
  unionParameterIntervals,
} from "./visibility-engine.js";

describe("radial visibility sweep", () => {
  it("matches legacy self-occlusion at a building corner", () => {
    const dataset = datasetFromFeatures([square("target", 500000, 3700000, 1, 1)]);
    expectSweepMatchesLegacy(dataset, [500000, 3700000], ["target"]);
  });

  it("matches legacy visibility through multiple obstacle shadows", () => {
    const dataset = datasetFromFeatures([
      square("host", 499999, 3699999, 1, 1),
      square("lower", 500003, 3699999.4, 1, 0.35),
      square("upper", 500005, 3700000.15, 1, 0.3),
      square("center", 500007, 3699999.95, 1, 0.1),
      square("target", 500010, 3699999, 1, 2),
    ]);
    expectSweepMatchesLegacy(dataset, [500000, 3700000], [
      "host",
      "lower",
      "upper",
      "center",
      "target",
    ]);
  });

  it("falls back for a target edge collinear with the antenna", () => {
    const dataset = datasetFromFeatures([
      square("host", 499999, 3699999, 1, 1),
      square("obstacle", 500004, 3699999.8, 2, 0.4),
      square("target", 500010, 3700000, 2, 1),
    ]);
    expectSweepMatchesLegacy(dataset, [500000, 3700000], ["target"]);
  });

  it.each([
    { penetration: 0, expectedVisibleFraction: 1 },
    { penetration: 0.0025, expectedVisibleFraction: 1 },
    { penetration: 0.003, expectedVisibleFraction: 0 },
  ])(
    "uses ArcGIS for a collinear target edge at $penetration m nominal penetration",
    ({ penetration, expectedVisibleFraction }) => {
      const dataset = datasetFromFeatures([
        square("host", 0, 0, 1, 1),
        square("obstacle", 2, penetration, 1, 1),
        square("target", 4, 0, 1, 1),
      ]);
      const target = dataset.buildingById.get("target");
      const topEdge = target?.edges.find((edge) => edge.start[1] === 1 && edge.end[1] === 1);
      if (target === undefined || topEdge === undefined) throw new Error("Expected target top edge.");

      const swept = computeRadialSweepVisibility(
        dataset,
        [0, 1],
        new Set([target.inputIndex]),
      );
      const intervals = swept.get(target.inputIndex)?.get(topEdge.edgeIndex) ?? [];
      const visibleFraction = intervals.reduce(
        (total, interval) => total + interval.end - interval.start,
        0,
      );

      expect(visibleFraction).toBeCloseTo(expectedVisibleFraction, 9);
      expectSweepMatchesLegacy(dataset, [0, 1], ["target"]);
    },
  );

  it("keeps a separate footprint less than 1 mm from the antenna in the sweep", () => {
    const dataset = datasetFromFeatures([
      square("host", -1, -1, 1, 1),
      square("near-obstacle", 0.0004, 0.0004, 0.01, 0.01),
      square("target", 2, 1, 1, 1),
    ]);
    expectSweepMatchesLegacy(dataset, [0, 0], ["near-obstacle", "target"]);
  });

  it("matches ArcGIS at a tolerance-sensitive obstacle shadow boundary", () => {
    const dataset = datasetFromFeatures([
      square("host", -1, -1, 1, 1),
      square("obstacle", 4, -1, 2, 1.003),
      square("target", 10, -1, 1, 2),
    ]);
    expectSweepMatchesLegacy(dataset, [0, 0], ["target"]);
  });

  it("matches legacy coverage across a deterministic field of disjoint buildings", () => {
    let seed = 0x5eed1234;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const features = [square("host", 499999, 3699999, 1, 1)];
    for (let index = 0; index < 18; index += 1) {
      features.push(square(
        `building-${index}`,
        500004 + index * 4,
        3699975 + random() * 50,
        1 + random(),
        1 + random() * 3,
      ));
    }
    const dataset = datasetFromFeatures(features);
    expectSweepMatchesLegacy(
      dataset,
      [500000, 3700000],
      dataset.buildings.map((building) => building.id),
    );
  });

  it("handles sweep wraparound and buildings in every quadrant", () => {
    const dataset = datasetFromFeatures([
      square("host", -1, -1, 1, 1),
      square("east", 5, -1, 2, 2),
      square("north", -1, 5, 2, 2),
      square("west", -7, -1, 2, 2),
      square("south", -1, -7, 2, 2),
      square("northeast", 8, 7, 2, 3),
      square("southwest", -10, -9, 3, 2),
    ]);
    expectSweepMatchesLegacy(
      dataset,
      [0, 0],
      dataset.buildings.map((building) => building.id),
    );
  });

  it("matches legacy visibility for concave, hole-free footprints", () => {
    const dataset = datasetFromFeatures([
      square("host", -1, -1, 1, 1),
      polygon("concave-obstacle", [
        [4, -3], [8, -3], [8, -1], [6, -1], [6, 1], [8, 1], [8, 3], [4, 3],
      ]),
      polygon("concave-target", [
        [12, -4], [16, -4], [16, 4], [12, 4], [12, 2], [14, 2], [14, -2], [12, -2],
      ]),
    ]);
    expectSweepMatchesLegacy(dataset, [0, 0], ["concave-obstacle", "concave-target"]);
  });

  it("cooperatively cancels while constructing a large sweep", async () => {
    const features = Array.from({ length: 1_500 }, (_, index) =>
      square(`building-${index}`, index * 3, 5, 1, 1));
    const dataset = datasetFromFeatures(features);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Test cancellation.", "AbortError")), 0);

    await expect(computeRadialSweepVisibilityAsync(
      dataset,
      [0, 0],
      new Set(dataset.buildings.map((building) => building.inputIndex)),
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
  });
});

function expectSweepMatchesLegacy(
  dataset: BuildingDataset,
  coordinate: Coordinate,
  buildingIds: readonly string[],
): void {
  const targets = new Set(buildingIds.map((id) => {
    const building = dataset.buildingById.get(id);
    if (building === undefined) throw new Error(`Missing test building ${id}.`);
    return building.inputIndex;
  }));
  const sweep = computeRadialSweepVisibility(dataset, coordinate, targets);
  const testAntenna = antenna(coordinate);

  for (const buildingId of buildingIds) {
    const building = dataset.buildingById.get(buildingId);
    if (building === undefined) throw new Error(`Missing test building ${buildingId}.`);
    const legacy = computeBuildingVisibility(dataset, buildingId, [testAntenna]);
    const sweptLength = building.edges.reduce((total, edge) => {
      const intervals = unionParameterIntervals(
        [],
        sweep.get(building.inputIndex)?.get(edge.edgeIndex) ?? [],
      );
      return total + intervals.reduce(
        (edgeTotal, interval) => edgeTotal + interval.end - interval.start,
        0,
      ) * edge.lengthMeters;
    }, 0);

    expect(sweptLength, buildingId).toBeCloseTo(legacy.visibleLengthMeters, 8);
  }
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

function polygon(id: string, vertices: readonly Coordinate[]): object {
  const first = vertices[0];
  if (first === undefined) throw new Error("Polygon test fixture needs vertices.");
  return {
    type: "Feature",
    properties: { id },
    geometry: {
      type: "Polygon",
      coordinates: [[...vertices, first]],
    },
  };
}

function antenna(coordinate: Coordinate): ValidatedAntenna {
  return {
    inputIndex: 1,
    submittedCoordinate: coordinate,
    evaluatedCoordinate: coordinate,
    boundaryDistanceMeters: 0,
    hostBuildingId: "host",
    snapped: false,
  };
}

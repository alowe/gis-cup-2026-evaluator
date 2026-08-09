import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { expect, test } from "vitest";

import { parseBuildingDatasetText } from "../src/core/dataset-loader.js";
import type { PreparedBuilding } from "../src/core/dataset-types.js";
import type { ValidatedAntenna } from "../src/core/submission-types.js";
import { computeBuildingVisibility } from "../src/core/visibility-engine.js";

const DEFAULT_SAMPLE_PATH = "datasets/GIS-cup-sample-dataset.geojson";
const DEFAULT_CLAIM_COUNT = 10;

test("reports sample dataset loading and visibility baselines", () => {
  const datasetPath = resolve(process.env.SAMPLE_DATASET ?? DEFAULT_SAMPLE_PATH);
  const claimCount = parsePositiveInteger(process.env.BENCHMARK_CLAIMS, DEFAULT_CLAIM_COUNT);
  const heapBefore = process.memoryUsage().heapUsed;
  const readStarted = performance.now();
  const text = readFileSync(datasetPath, "utf8");
  const readMilliseconds = performance.now() - readStarted;
  const loadStarted = performance.now();
  const dataset = parseBuildingDatasetText(text);
  const loadMilliseconds = performance.now() - loadStarted;
  const heapAfterLoad = process.memoryUsage().heapUsed;

  const host = dataset.buildings[0];
  if (host === undefined || host.vertices[0] === undefined) {
    throw new Error("The benchmark dataset contains no usable building.");
  }
  const antenna: ValidatedAntenna = {
    inputIndex: 0,
    submittedCoordinate: host.vertices[0],
    evaluatedCoordinate: host.vertices[0],
    boundaryDistanceMeters: 0,
    hostBuildingId: host.id,
    snapped: false,
  };
  const targets = nearestBuildings(dataset.buildings, host, claimCount);
  const coverages: number[] = [];
  const visibilityStarted = performance.now();
  for (const target of targets) {
    const visibility = computeBuildingVisibility(dataset, target.id, [antenna], {
      requiredVisibleLengthMeters: target.perimeterMeters * 0.5,
    });
    coverages.push(visibility.coverage);
  }
  const visibilityMilliseconds = performance.now() - visibilityStarted;

  const result = {
    datasetPath,
    fileSizeBytes: statSync(datasetPath).size,
    buildingCount: dataset.buildings.length,
    edgeCount: dataset.edgeCount,
    vertexCount: dataset.vertexCount,
    readMilliseconds: round(readMilliseconds),
    loadMilliseconds: round(loadMilliseconds),
    heapGrowthMegabytes: round((heapAfterLoad - heapBefore) / 1024 / 1024),
    visibilityClaimCount: targets.length,
    visibilityMilliseconds: round(visibilityMilliseconds),
    averageVisibilityMilliseconds: round(visibilityMilliseconds / Math.max(1, targets.length)),
    firstBuildingId: targets[0]?.id,
    firstBuildingCoverage: coverages[0] === undefined ? undefined : round(coverages[0]),
  };

  console.log(`\nSAMPLE_BENCHMARK ${JSON.stringify(result, null, 2)}`);
  expect(dataset.buildings.length).toBeGreaterThan(0);
});

function nearestBuildings(
  buildings: readonly PreparedBuilding[],
  host: PreparedBuilding,
  count: number,
): PreparedBuilding[] {
  const centerX = (host.extent.xmin + host.extent.xmax) / 2;
  const centerY = (host.extent.ymin + host.extent.ymax) / 2;
  return [...buildings]
    .sort((left, right) => {
      const leftDistance = Math.hypot(
        (left.extent.xmin + left.extent.xmax) / 2 - centerX,
        (left.extent.ymin + left.extent.ymax) / 2 - centerY,
      );
      const rightDistance = Math.hypot(
        (right.extent.xmin + right.extent.xmax) / 2 - centerX,
        (right.extent.ymin + right.extent.ymax) / 2 - centerY,
      );
      return leftDistance - rightDistance || left.inputIndex - right.inputIndex;
    })
    .slice(0, count);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

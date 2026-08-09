import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { expect, test } from "vitest";

import { parseBuildingDatasetText } from "../src/core/dataset-loader.js";
import { evaluateValidatedSubproblemAsync } from "../src/core/evaluation-engine.js";
import { parseSolutionText } from "../src/core/solution-parser.js";
import { validateSubproblemInput } from "../src/core/submission-validator.js";

const DEFAULT_SAMPLE_PATH = "datasets/GIS-cup-sample-dataset.geojson";
const ANTENNA_COUNT = 50;

test("evaluates all sample buildings with 50 antennas", async () => {
  const datasetPath = resolve(process.env.SAMPLE_DATASET ?? DEFAULT_SAMPLE_PATH);
  const dataset = parseBuildingDatasetText(readFileSync(datasetPath, "utf8"));
  const antennaBuildings = evenlySpacedBuildings(dataset.buildings.length, ANTENNA_COUNT);
  const antennaLine = antennaBuildings.map((buildingIndex) => {
    const coordinate = dataset.buildings[buildingIndex]?.vertices[0];
    if (coordinate === undefined) throw new Error(`Building ${buildingIndex} has no vertex.`);
    return `(${coordinate[0]}, ${coordinate[1]})`;
  }).join(", ");
  const claimLine = dataset.buildings.map((building) => building.id).join(", ");
  const parsed = parseSolutionText(`(0.5, ${ANTENNA_COUNT})\n${antennaLine}\n${claimLine}`);
  const source = parsed.subproblems[0];
  if (source === undefined) throw new Error("Expected one stress-test subproblem.");
  const validated = validateSubproblemInput(source, dataset);
  const heapBefore = process.memoryUsage().heapUsed;
  let completedAntennaCount = 0;

  const evaluationStarted = performance.now();
  const result = await evaluateValidatedSubproblemAsync(dataset, validated, {
    fullDiagnosticCoverage: true,
    onAntennaProgress: (progress) => {
      completedAntennaCount = progress.completedAntennaCount;
    },
  });
  const evaluationMilliseconds = performance.now() - evaluationStarted;
  const heapAfter = process.memoryUsage().heapUsed;

  const benchmark = {
    datasetPath,
    buildingCount: dataset.buildings.length,
    edgeCount: dataset.edgeCount,
    antennaCount: validated.uniqueAntennas.length,
    claimedBuildingCount: validated.claims.uniqueKnownIds.length,
    evaluatedBuildingCount: result.buildingResults.length,
    verifiedBuildingCount: result.verifiedServiceScore,
    evaluationMilliseconds: round(evaluationMilliseconds),
    averageMillisecondsPerAntenna: round(evaluationMilliseconds / ANTENNA_COUNT),
    evaluationHeapGrowthMegabytes: round((heapAfter - heapBefore) / 1024 / 1024),
  };

  console.log(`\nSAMPLE_STRESS_BENCHMARK ${JSON.stringify(benchmark, null, 2)}`);
  expect(validated.uniqueAntennas).toHaveLength(ANTENNA_COUNT);
  expect(validated.claims.uniqueKnownIds).toHaveLength(dataset.buildings.length);
  expect(completedAntennaCount).toBe(ANTENNA_COUNT);
  expect(result.buildingResults).toHaveLength(dataset.buildings.length);
  expect(result.buildingResults.every((building) => building.coverageKind === "complete")).toBe(true);
});

function evenlySpacedBuildings(buildingCount: number, count: number): number[] {
  if (buildingCount < count) {
    throw new Error(`The stress dataset needs at least ${count} buildings.`);
  }
  return Array.from({ length: count }, (_, index) => Math.floor(index * buildingCount / count));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

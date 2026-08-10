import { describe, expect, it } from "vitest";

import packageMetadata from "../../package.json";
import { loadBuildingDataset } from "./dataset-loader.js";
import { evaluateValidatedSubproblem } from "./evaluation-engine.js";
import { sha256Hex } from "./hash.js";
import { buildEvaluationReport } from "./report-builder.js";
import { parseSolutionText } from "./solution-parser.js";
import { validateSubproblemInput } from "./submission-validator.js";

describe("evaluation report", () => {
  it("calculates standard SHA-256 hex digests", async () => {
    const bytes = new TextEncoder().encode("abc");

    await expect(sha256Hex(bytes.buffer)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("builds a reproducible plain JSON report with lower-bound coverage", () => {
    const dataset = squareDataset();
    const parsed = parseSolutionText(
      "(0.25, 2)\n(500000, 3700000), (500001, 3700001)\ntarget",
    );
    const source = parsed.subproblems[0];
    if (source === undefined) throw new Error("Expected subproblem.");
    const validated = validateSubproblemInput(source, dataset);
    const evaluated = evaluateValidatedSubproblem(dataset, validated);
    const report = buildEvaluationReport(
      dataset,
      { fileName: "buildings.geojson", sha256: "dataset-hash" },
      { fileName: "solution.txt", sha256: "solution-hash" },
      [evaluated],
      false,
      new Date("2026-08-09T12:00:00.000Z"),
    );
    const serialized = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;

    expect(report).toMatchObject({
      schemaVersion: "1.0",
      evaluatorVersion: packageMetadata.version,
      arcgisVersion: packageMetadata.dependencies["@arcgis/core"],
      generatedAt: "2026-08-09T12:00:00.000Z",
      dataset: { sha256: "dataset-hash", buildingCount: 1 },
      solution: { sha256: "solution-hash" },
    });
    expect(report.subproblems[0]?.buildingResults[0]).toMatchObject({
      coverageKind: "lower-bound",
      coverageLowerBound: 0.5,
      processedAntennaCount: 1,
    });
    expect(serialized).not.toHaveProperty("subproblems.0.buildingResults.0.coverage");
  });
});

function squareDataset() {
  return loadBuildingDataset({
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "EPSG:32611" } },
    features: [{
      type: "Feature",
      properties: { id: "target" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [500000, 3700000],
          [500001, 3700000],
          [500001, 3700001],
          [500000, 3700001],
          [500000, 3700000],
        ]],
      },
    }],
  });
}

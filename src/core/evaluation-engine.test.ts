import { describe, expect, it } from "vitest";

import { loadBuildingDataset } from "./dataset-loader.js";
import { evaluateValidatedSubproblem } from "./evaluation-engine.js";
import { parseSolutionText } from "./solution-parser.js";
import { validateSubproblemInput } from "./submission-validator.js";

describe("subproblem evaluation", () => {
  it("counts coverage exactly equal to tau as serviced", () => {
    const dataset = squareDataset();
    const result = evaluate(dataset, "(0.5, 1)\n(500000, 3700000)\ntarget");

    expect(result.buildingResults[0]?.coverage).toBeCloseTo(0.5, 9);
    expect(result.buildingResults[0]?.verified).toBe(true);
    expect(result.verifiedBuildingIds).toEqual(["target"]);
    expect(result.verifiedServiceScore).toBe(1);
  });

  it("rejects a claim immediately above computed coverage", () => {
    const dataset = squareDataset();
    const result = evaluate(dataset, "(0.500001, 1)\n(500000, 3700000)\ntarget");

    expect(result.verifiedServiceScore).toBe(0);
    expect(result.buildingResults[0]?.verified).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toContain("CLAIM_BELOW_THRESHOLD");
  });

  it("does not evaluate unclaimed or unknown buildings", () => {
    const dataset = loadBuildingDataset({
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "EPSG:32611" } },
      features: [
        squareFeature("claimed", 500000),
        squareFeature("unclaimed", 500010),
      ],
    });
    const evaluatedIds: string[] = [];
    const parsed = parseSolutionText("(0.5, 1)\n(500000, 3700000)\nclaimed, missing");
    const subproblem = parsed.subproblems[0];
    if (subproblem === undefined) throw new Error("Expected subproblem.");
    const validated = validateSubproblemInput(subproblem, dataset);

    const result = evaluateValidatedSubproblem(dataset, validated, {
      onBuildingEvaluation: (buildingId) => evaluatedIds.push(buildingId),
    });

    expect(evaluatedIds).toEqual(["claimed"]);
    expect(result.buildingResults.map((building) => building.buildingId)).toEqual(["claimed"]);
  });

  it("returns score zero without geometry work for invalid parameters", () => {
    const dataset = squareDataset();
    const evaluatedIds: string[] = [];
    const parsed = parseSolutionText("(0, 1)\n(500000, 3700000)\ntarget");
    const subproblem = parsed.subproblems[0];
    if (subproblem === undefined) throw new Error("Expected subproblem.");
    const validated = validateSubproblemInput(subproblem, dataset);

    const result = evaluateValidatedSubproblem(dataset, validated, {
      onBuildingEvaluation: (buildingId) => evaluatedIds.push(buildingId),
    });

    expect(result.verifiedServiceScore).toBe(0);
    expect(evaluatedIds).toEqual([]);
  });
});

function evaluate(dataset: ReturnType<typeof squareDataset>, solution: string) {
  const parsed = parseSolutionText(solution);
  const subproblem = parsed.subproblems[0];
  if (subproblem === undefined) throw new Error("Expected subproblem.");
  const validated = validateSubproblemInput(subproblem, dataset);
  return evaluateValidatedSubproblem(dataset, validated);
}

function squareDataset() {
  return loadBuildingDataset({
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "EPSG:32611" } },
    features: [squareFeature("target", 500000)],
  });
}

function squareFeature(id: string, xmin: number): object {
  return {
    type: "Feature",
    properties: { id },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [xmin, 3700000],
        [xmin + 1, 3700000],
        [xmin + 1, 3700001],
        [xmin, 3700001],
        [xmin, 3700000],
      ]],
    },
  };
}

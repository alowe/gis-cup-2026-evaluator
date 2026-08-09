import { describe, expect, it } from "vitest";

import { loadBuildingDataset, parseBuildingDatasetText } from "./dataset-loader.js";
import { parseSolutionText } from "./solution-parser.js";
import { validateSubproblemInput } from "./submission-validator.js";
import threeSquaresJson from "./test-data/three-squares.geojson?raw";

describe("dataset-aware submission validation", () => {
  it("accepts and snaps retained antennas within 1 mm of a boundary", () => {
    const validated = validate(
      "(0.5, 3)\n(499999.999001, 3700000.5), (499999.999, 3700000.5), (499999.998999, 3700000.5)\n1",
    );

    expect(validated.validAntennas).toHaveLength(2);
    expect(validated.invalidRetainedAntennaCount).toBe(1);
    expect(validated.validAntennas.map((antenna) => antenna.evaluatedCoordinate)).toEqual([
      [500000, 3700000.5],
      [500000, 3700000.5],
    ]);
    expect(validated.warnings.map((warning) => warning.code)).toEqual([
      "ANTENNA_SNAPPED",
      "DUPLICATE_ANTENNA",
      "ANTENNA_SNAPPED",
      "ANTENNA_OFF_BOUNDARY",
    ]);
  });

  it("uses lexicographically smallest building ID when distances tie", () => {
    const dataset = loadBuildingDataset(twoNearlyTouchingSquares());
    const parsed = parseSolutionText("(1, 1)\n(500001.001, 3700000.5)\na");
    const subproblem = parsed.subproblems[0];
    if (subproblem === undefined) throw new Error("Expected parsed subproblem.");

    const validated = validateSubproblemInput(subproblem, dataset);

    expect(validated.validAntennas[0]?.hostBuildingId).toBe("a");
    expect(validated.validAntennas[0]?.evaluatedCoordinate[0]).toBeCloseTo(500001.002, 9);
  });

  it("resolves known, duplicate, and unknown claimed IDs in submission order", () => {
    const validated = validate("(0.5, 0)\n\n1, 1, missing, third, missing");

    expect(validated.claims.reportedIds).toEqual(["1", "1", "missing", "third", "missing"]);
    expect(validated.claims.uniqueKnownIds).toEqual(["1", "third"]);
    expect(validated.claims.unknownIds).toEqual(["missing"]);
    expect(validated.claims.duplicateIds).toEqual(["1", "missing"]);
    expect(validated.warnings.map((warning) => warning.code)).toEqual([
      "DUPLICATE_BUILDING_ID",
      "UNKNOWN_BUILDING_ID",
      "DUPLICATE_BUILDING_ID",
    ]);
  });

  it("does not backfill a valid antenna after k", () => {
    const validated = validate(
      "(0.5, 2)\n(bad, value), (499999, 3700000), (500000, 3700000.5)\n1",
    );

    expect(validated.source.retainedAntennas.map((entry) => entry.inputIndex)).toEqual([1, 2]);
    expect(validated.validAntennas).toHaveLength(0);
    expect(validated.invalidRetainedAntennaCount).toBe(2);
    expect(validated.warnings.map((warning) => warning.code)).toEqual([
      "MALFORMED_ANTENNA",
      "EXTRA_ANTENNAS",
      "ANTENNA_OFF_BOUNDARY",
    ]);
  });

  it("keeps duplicate antennas valid but exposes one unique evaluation position", () => {
    const validated = validate(
      "(0.5, 2)\n(500000, 3700000.5), (500000, 3700000.5)\n1",
    );

    expect(validated.validAntennas).toHaveLength(2);
    expect(validated.uniqueAntennas).toHaveLength(1);
    expect(validated.validAntennas[1]?.duplicateOfInputIndex).toBe(1);
    expect(validated.warnings.map((warning) => warning.code)).toEqual(["DUPLICATE_ANTENNA"]);
  });
});

function validate(solutionText: string) {
  const dataset = parseBuildingDatasetText(threeSquaresJson);
  const parsed = parseSolutionText(solutionText);
  const subproblem = parsed.subproblems[0];
  if (subproblem === undefined) throw new Error("Expected parsed subproblem.");
  return validateSubproblemInput(subproblem, dataset);
}

function twoNearlyTouchingSquares(): object {
  return {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "EPSG:32611" } },
    features: [
      squareFeature("z", 500000),
      squareFeature("a", 500001.002),
    ],
  };
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

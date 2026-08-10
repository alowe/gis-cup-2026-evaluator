import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

import { parseBuildingDatasetText } from "../src/core/dataset-loader.js";
import { parseSolutionText } from "../src/core/solution-parser.js";
import { validateSubproblemInput } from "../src/core/submission-validator.js";

test("validates the generated 50-antenna sample submission", () => {
  const dataset = parseBuildingDatasetText(readFileSync(
    resolve("datasets/GIS-cup-sample-dataset.geojson"),
    "utf8",
  ));
  const solution = parseSolutionText(readFileSync(
    resolve("datasets/GIS-cup-sample-submission-50-antennas.txt"),
    "utf8",
  ));
  const source = solution.subproblems[0];
  if (source === undefined) throw new Error("Expected one generated subproblem.");
  const validated = validateSubproblemInput(source, dataset);

  expect(solution.subproblems).toHaveLength(1);
  expect(source.tau).toBe(0.5);
  expect(source.k).toBe(50);
  expect(validated.validAntennas).toHaveLength(50);
  expect(validated.uniqueAntennas).toHaveLength(50);
  expect(validated.invalidRetainedAntennaCount).toBe(0);
  expect(validated.claims.uniqueKnownIds).toHaveLength(140);
  expect(validated.claims.unknownIds).toEqual([]);
  expect(validated.claims.duplicateIds).toEqual([]);
  expect(validated.warnings).toEqual([]);
});

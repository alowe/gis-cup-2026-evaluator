import { describe, expect, it } from "vitest";

import buildingsText from "../../datasets/ui-smoke/buildings.geojson?raw";
import passText from "../../datasets/ui-smoke/01-pass-exact-threshold.txt?raw";
import failText from "../../datasets/ui-smoke/02-fail-above-threshold.txt?raw";
import snapText from "../../datasets/ui-smoke/03-pass-with-snap.txt?raw";
import offBoundaryText from "../../datasets/ui-smoke/04-invalid-off-boundary.txt?raw";
import duplicateText from "../../datasets/ui-smoke/05-duplicates-and-unknown-claims.txt?raw";
import multipleText from "../../datasets/ui-smoke/06-multiple-configurations.txt?raw";
import { parseBuildingDatasetText } from "./dataset-loader.js";
import { evaluateValidatedSubproblem } from "./evaluation-engine.js";
import { parseSolutionText } from "./solution-parser.js";
import { validateSubproblemInput } from "./submission-validator.js";

const dataset = parseBuildingDatasetText(buildingsText);

describe("UI smoke-test fixtures", () => {
  it.each([
    ["01-pass-exact-threshold.txt", passText, [1]],
    ["02-fail-above-threshold.txt", failText, [0]],
    ["03-pass-with-snap.txt", snapText, [1]],
    ["04-invalid-off-boundary.txt", offBoundaryText, [0]],
    ["05-duplicates-and-unknown-claims.txt", duplicateText, [1]],
    ["06-multiple-configurations.txt", multipleText, [1, 0, 0]],
  ] as const)("produces documented scores for %s", (_fileName, solutionText, expectedScores) => {
    const parsed = parseSolutionText(solutionText);
    const scores = parsed.subproblems.map((subproblem) => {
      const validated = validateSubproblemInput(subproblem, dataset);
      return evaluateValidatedSubproblem(dataset, validated).verifiedServiceScore;
    });

    expect(scores).toEqual(expectedScores);
  });
});

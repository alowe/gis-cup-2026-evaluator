import { describe, expect, it } from "vitest";

import { parseSolutionText } from "./solution-parser.js";

describe("solution parser", () => {
  it("parses one complete configuration with decimal and scientific notation", () => {
    const parsed = parseSolutionText([
      "\uFEFF(5e-1, 2)",
      "(480799.25, 3.765948e6), (480857.125, 3765978.75)",
      "1, 17, building-203",
    ].join("\r\n"));

    expect(parsed.subproblems).toHaveLength(1);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.subproblems[0]).toMatchObject({
      complete: true,
      tau: 0.5,
      k: 2,
      parametersValid: true,
      claimedBuildingIds: ["1", "17", "building-203"],
    });
    expect(parsed.subproblems[0]?.antennas).toHaveLength(2);
    expect(parsed.subproblems[0]?.retainedAntennas).toHaveLength(2);
  });

  it("preserves blank antenna and building lines", () => {
    const parsed = parseSolutionText("(0.75, 0)\n\n");

    expect(parsed.subproblems).toHaveLength(1);
    expect(parsed.subproblems[0]?.antennas).toEqual([]);
    expect(parsed.subproblems[0]?.claimedBuildingIds).toEqual([]);
    expect(parsed.subproblems[0]?.complete).toBe(true);
  });

  it("truncates before validation and never backfills after k", () => {
    const parsed = parseSolutionText([
      "(0.5, 3)",
      "(0, 0), (bad, 1), (2, 2), (3, 3)",
      "1",
    ].join("\n"));
    const subproblem = parsed.subproblems[0];

    expect(subproblem?.antennas).toHaveLength(4);
    expect(subproblem?.retainedAntennas.map((entry) => entry.inputIndex)).toEqual([1, 2, 3]);
    expect(subproblem?.retainedAntennas.map((entry) => entry.status)).toEqual([
      "valid",
      "malformed",
      "valid",
    ]);
    expect(parsed.warnings.map((warning) => warning.code)).toEqual([
      "MALFORMED_ANTENNA",
      "EXTRA_ANTENNAS",
    ]);
  });

  it("distinguishes malformed and nonfinite antenna entries", () => {
    const parsed = parseSolutionText([
      "(0.5, 4)",
      "(NaN, 1), (1e9999, 2), unmatched, (3, 4)",
      "1",
    ].join("\n"));

    expect(parsed.subproblems[0]?.antennas.map((entry) => entry.status)).toEqual([
      "nonfinite",
      "nonfinite",
      "malformed",
      "valid",
    ]);
    expect(parsed.warnings.map((warning) => warning.code)).toEqual([
      "NONFINITE_ANTENNA",
      "NONFINITE_ANTENNA",
      "MALFORMED_ANTENNA",
    ]);
  });

  it("does not validate or warn about entries after k", () => {
    const parsed = parseSolutionText([
      "(0.5, 1)",
      "(1, 1), (bad, value)",
      "1",
    ].join("\n"));

    expect(parsed.subproblems[0]?.antennas.map((entry) => entry.status)).toEqual([
      "valid",
      "malformed",
    ]);
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(["EXTRA_ANTENNAS"]);
  });

  it("reports invalid parameters without guessing values", () => {
    const parsed = parseSolutionText("(0, 2.5)\n(1, 2)\n1\n");
    const subproblem = parsed.subproblems[0];

    expect(subproblem?.parametersValid).toBe(false);
    expect(subproblem?.tau).toBeUndefined();
    expect(subproblem?.k).toBeUndefined();
    expect(subproblem?.retainedAntennas).toEqual([]);
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(["INVALID_TAU", "INVALID_K"]);
  });

  it("retains duplicate claims and excludes empty claim tokens for later validation", () => {
    const parsed = parseSolutionText("(1, 0)\n\n1, 1, , 2\n");

    expect(parsed.subproblems[0]?.claimedBuildingIds).toEqual(["1", "1", "2"]);
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(["EMPTY_BUILDING_ID"]);
  });

  it("reports and retains an incomplete final block", () => {
    const parsed = parseSolutionText("(0.5, 1)\n(1, 2)");

    expect(parsed.subproblems).toHaveLength(1);
    expect(parsed.subproblems[0]?.complete).toBe(false);
    expect(parsed.warnings.map((warning) => warning.code)).toContain("INCOMPLETE_SUBPROBLEM");
  });

  it("parses multiple independent three-line blocks", () => {
    const parsed = parseSolutionText([
      "(0.5, 1)",
      "(1, 2)",
      "1",
      "(0.9, 0)",
      "",
      "2, 3",
    ].join("\n"));

    expect(parsed.subproblems).toHaveLength(2);
    expect(parsed.subproblems.map((subproblem) => subproblem.tau)).toEqual([0.5, 0.9]);
  });
});

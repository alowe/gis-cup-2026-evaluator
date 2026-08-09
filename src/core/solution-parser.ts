import type {
  ParsedAntennaEntry,
  ParsedSolution,
  ParsedSubproblem,
  SolutionWarning,
} from "./solution-types.js";

const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NONFINITE_NAME_PATTERN = /^[+-]?(?:Infinity|NaN)$/i;

export function parseSolutionText(text: string): ParsedSolution {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "" && lines.length % 3 === 1) lines.pop();

  const subproblems: ParsedSubproblem[] = [];
  const warnings: SolutionWarning[] = [];

  for (let offset = 0; offset < lines.length; offset += 3) {
    const index = subproblems.length + 1;
    const block = lines.slice(offset, offset + 3);
    const subproblem = parseSubproblem(index, block);
    subproblems.push(subproblem);
    warnings.push(...subproblem.warnings);
  }

  return { subproblems, warnings };
}

function parseSubproblem(index: number, lines: readonly string[]): ParsedSubproblem {
  const warnings: SolutionWarning[] = [];
  const complete = lines.length === 3;

  if (!complete) {
    warnings.push({
      code: "INCOMPLETE_SUBPROBLEM",
      subproblemIndex: index,
      message: `Subproblem ${index} has ${lines.length} of 3 required lines.`,
      action: "Score this incomplete block as zero.",
    });
  }

  const parameters = parseParameters(lines[0] ?? "", index, warnings);
  const antennas = parseAntennaEntries(lines[1] ?? "");
  const retainedAntennas = parameters.k === undefined
    ? []
    : antennas.slice(0, parameters.k);

  for (const entry of retainedAntennas) {
    if (entry.status === "nonfinite") {
      warnings.push({
        code: "NONFINITE_ANTENNA",
        subproblemIndex: index,
        entryIndex: entry.inputIndex,
        message: `Antenna entry ${entry.inputIndex} contains a nonfinite coordinate.`,
        action: "Exclude this retained entry from visibility evaluation.",
      });
    } else if (entry.status === "malformed") {
      warnings.push({
        code: "MALFORMED_ANTENNA",
        subproblemIndex: index,
        entryIndex: entry.inputIndex,
        message: `Antenna entry ${entry.inputIndex} is not a valid coordinate pair.`,
        action: "Exclude this retained entry from visibility evaluation.",
      });
    }
  }

  if (parameters.k !== undefined && antennas.length > parameters.k) {
    warnings.push({
      code: "EXTRA_ANTENNAS",
      subproblemIndex: index,
      message: `Reported ${antennas.length} antenna entries for k=${parameters.k}.`,
      action: `Retain only the first ${parameters.k} entries without backfilling.`,
    });
  }

  const claimedBuildingIds = parseClaimedBuildingIds(lines[2] ?? "", index, warnings);

  return {
    index,
    complete,
    tau: parameters.tau,
    k: parameters.k,
    parametersValid: parameters.tau !== undefined && parameters.k !== undefined,
    antennas,
    retainedAntennas,
    claimedBuildingIds,
    warnings,
  };
}

function parseParameters(
  line: string,
  subproblemIndex: number,
  warnings: SolutionWarning[],
): { readonly tau?: number; readonly k?: number } {
  const match = /^\(\s*([^,]*)\s*,\s*([^,]*)\s*\)$/.exec(line.trim());
  const tauToken = match?.[1]?.trim();
  const kToken = match?.[2]?.trim();
  const tauValue = tauToken === undefined ? undefined : parseDecimal(tauToken);
  const kValue = kToken === undefined ? undefined : parseDecimal(kToken);
  const tau = tauValue !== undefined && Number.isFinite(tauValue) && tauValue > 0 && tauValue <= 1
    ? tauValue
    : undefined;
  const k = kValue !== undefined && Number.isSafeInteger(kValue) && kValue >= 0
    ? kValue
    : undefined;

  if (tau === undefined) {
    warnings.push({
      code: "INVALID_TAU",
      subproblemIndex,
      message: `Subproblem ${subproblemIndex} has an invalid tau value.`,
      action: "Score this subproblem as zero and skip geometry evaluation.",
    });
  }

  if (k === undefined) {
    warnings.push({
      code: "INVALID_K",
      subproblemIndex,
      message: `Subproblem ${subproblemIndex} has an invalid k value.`,
      action: "Score this subproblem as zero and skip geometry evaluation.",
    });
  }

  return { tau, k };
}

function parseAntennaEntries(line: string): ParsedAntennaEntry[] {
  if (line.trim() === "") return [];

  const rawEntries = scanParenthesizedEntries(line);
  return rawEntries.map((raw, arrayIndex) => {
    const inputIndex = arrayIndex + 1;
    const inner = raw.startsWith("(") && raw.endsWith(")")
      ? raw.slice(1, -1)
      : undefined;
    const tokens = inner?.split(",");

    if (tokens?.length === 2) {
      const x = parseDecimal(tokens[0]?.trim() ?? "");
      const y = parseDecimal(tokens[1]?.trim() ?? "");

      if (x !== undefined && y !== undefined) {
        if (Number.isFinite(x) && Number.isFinite(y)) {
          return { inputIndex, raw, status: "valid", coordinate: [x, y] };
        }

        return { inputIndex, raw, status: "nonfinite" };
      }
    }

    return { inputIndex, raw, status: "malformed" };
  });
}

function scanParenthesizedEntries(line: string): string[] {
  const entries: string[] = [];
  let cursor = 0;

  while (cursor < line.length) {
    while (cursor < line.length && (line[cursor] === "," || /\s/.test(line[cursor] ?? ""))) {
      cursor += 1;
    }
    if (cursor >= line.length) break;

    const start = cursor;
    if (line[cursor] === "(") {
      const close = line.indexOf(")", cursor + 1);
      if (close === -1) {
        entries.push(line.slice(start).trim());
        break;
      }
      entries.push(line.slice(start, close + 1).trim());
      cursor = close + 1;
      continue;
    }

    while (cursor < line.length && line[cursor] !== "," && line[cursor] !== "(") {
      cursor += 1;
    }
    const malformed = line.slice(start, cursor).trim();
    if (malformed !== "") entries.push(malformed);
  }

  return entries;
}

function parseClaimedBuildingIds(
  line: string,
  subproblemIndex: number,
  warnings: SolutionWarning[],
): string[] {
  if (line.trim() === "") return [];

  const ids: string[] = [];
  for (const [arrayIndex, token] of line.split(",").entries()) {
    const id = token.trim();
    if (id === "") {
      warnings.push({
        code: "EMPTY_BUILDING_ID",
        subproblemIndex,
        entryIndex: arrayIndex + 1,
        message: `Claimed building entry ${arrayIndex + 1} is empty.`,
        action: "Exclude this entry from evaluation.",
      });
    } else {
      ids.push(id);
    }
  }

  return ids;
}

function parseDecimal(token: string): number | undefined {
  if (!DECIMAL_PATTERN.test(token) && !NONFINITE_NAME_PATTERN.test(token)) return undefined;
  return Number(token);
}

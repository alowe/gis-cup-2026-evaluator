import { describe, expect, it } from "vitest";

import { SPATIAL_TOLERANCE_METERS, TEST_SPATIAL_REFERENCE_WKID } from "./constants.js";
import { point, unitSquare } from "./fixtures.js";
import { isBlockedByPolygon } from "./line-of-sight.js";
import { createMeterSpatialReference } from "./spatial-reference.js";

const spatialReference = createMeterSpatialReference(TEST_SPATIAL_REFERENCE_WKID);
const baseX = 500_000;
const baseY = 3_700_000;
const start = point(baseX, baseY + 1, spatialReference);
const end = point(baseX + 5, baseY + 1, spatialReference);

describe("ArcGIS line-of-sight tolerance", () => {
  it("configures the contest XY tolerance", () => {
    expect(spatialReference.xyTolerance).toBe(SPATIAL_TOLERANCE_METERS);
    expect(spatialReference.unit).toBe("meters");
  });

  it("does not block a sight line that lies on the obstacle boundary", () => {
    const obstacle = unitSquare(baseX + 2, baseY, spatialReference);

    expect(isBlockedByPolygon(start, end, obstacle)).toBe(false);
  });

  it.each([
    { penetration: 0.000_999, expectedBlocked: false },
    { penetration: 0.001, expectedBlocked: false },
    { penetration: 0.001_000_01, expectedBlocked: false },
    { penetration: 0.002_5, expectedBlocked: false },
    { penetration: 0.003, expectedBlocked: true },
  ])(
    "characterizes blocked=$expectedBlocked at $penetration m nominal penetration",
    ({ penetration, expectedBlocked }) => {
      const obstacle = unitSquare(baseX + 2, baseY + penetration, spatialReference);

      expect(isBlockedByPolygon(start, end, obstacle)).toBe(expectedBlocked);
    },
  );

  it("blocks an unambiguously interior crossing", () => {
    const obstacle = unitSquare(baseX + 2, baseY + 0.5, spatialReference);

    expect(isBlockedByPolygon(start, end, obstacle)).toBe(true);
  });

  it("does not block a vertex-only contact", () => {
    const obstacle = unitSquare(baseX + 2, baseY + 1, spatialReference);

    expect(isBlockedByPolygon(start, end, obstacle)).toBe(false);
  });
});

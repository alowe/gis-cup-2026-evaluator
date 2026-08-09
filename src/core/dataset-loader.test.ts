import { describe, expect, it } from "vitest";

import threeSquaresJson from "./test-data/three-squares.geojson?raw";
import { DatasetValidationError, type DatasetErrorCode } from "./dataset-errors.js";
import { loadBuildingDataset, parseBuildingDatasetText } from "./dataset-loader.js";

type MutableJsonRecord = Record<string, unknown>;

describe("building dataset loader", () => {
  it("loads and preprocesses projected, meter-based polygons", () => {
    const dataset = parseBuildingDatasetText(threeSquaresJson);

    expect(dataset.spatialReferenceWkid).toBe(32611);
    expect(dataset.spatialReference.xyTolerance).toBe(0.001);
    expect(dataset.buildings).toHaveLength(3);
    expect(dataset.buildingById.get("1")).toBe(dataset.buildings[0]);
    expect(dataset.buildingById.has("third")).toBe(true);
    expect(dataset.edgeCount).toBe(12);
    expect(dataset.vertexCount).toBe(12);
    expect(dataset.buildings.map((building) => building.perimeterMeters)).toEqual([4, 4, 4]);
    expect(dataset.buildings.every((building) => building.edges.length === 4)).toBe(true);
  });

  it("accepts a UTF-8 BOM and common named EPSG forms", () => {
    const names = [
      "EPSG:32611",
      "urn:ogc:def:crs:EPSG::32611",
      "urn:ogc:def:crs:EPSG:6.6:32611",
      "https://www.opengis.net/def/crs/EPSG/0/32611",
      "http://www.opengis.net/gml/srs/epsg.xml#32611",
    ];

    for (const name of names) {
      const input = validInput();
      crsProperties(input).name = name;
      const dataset = parseBuildingDatasetText(`\uFEFF${JSON.stringify(input)}`);

      expect(dataset.spatialReferenceWkid).toBe(32611);
    }
  });

  it("rejects source IDs that collide after canonicalization", () => {
    const input = validInput();
    const features = featureArray(input);
    const source = features[0];
    if (source === undefined) {
      throw new Error("Test fixture unexpectedly has no feature.");
    }
    const duplicate = structuredClone(source);
    featureProperties(duplicate).id = " 1 ";
    features.push(duplicate);

    expectDatasetError(() => loadBuildingDataset(input), "DUPLICATE_BUILDING_ID", 3);
  });

  it("requires an explicitly declared projected, meter-based CRS", () => {
    const missing = validInput();
    delete missing.crs;
    expectDatasetError(() => loadBuildingDataset(missing), "MISSING_CRS");

    const geographic = validInput();
    crsProperties(geographic).name = "EPSG:4326";
    expectDatasetError(() => loadBuildingDataset(geographic), "UNSUPPORTED_CRS");

    const feet = validInput();
    crsProperties(feet).name = "EPSG:2263";
    expectDatasetError(() => loadBuildingDataset(feet), "UNSUPPORTED_CRS");
  });

  it("rejects holes and non-Polygon geometries", () => {
    const withHole = validInput();
    const coordinates = geometryRecord(featureArray(withHole)[0]).coordinates as unknown[];
    coordinates.push(structuredClone(coordinates[0]));
    expectDatasetError(() => loadBuildingDataset(withHole), "HOLES_NOT_ALLOWED", 0);

    const pointGeometry = validInput();
    geometryRecord(featureArray(pointGeometry)[0]).type = "Point";
    expectDatasetError(() => loadBuildingDataset(pointGeometry), "UNSUPPORTED_GEOMETRY", 0);
  });

  it("rejects open, nonfinite, and non-2D rings", () => {
    const open = validInput();
    ring(open).pop();
    expectDatasetError(() => loadBuildingDataset(open), "RING_NOT_CLOSED", 0);

    const nonfinite = validInput();
    ring(nonfinite)[1] = [Number.NaN, 3_700_000];
    expectDatasetError(() => loadBuildingDataset(nonfinite), "NONFINITE_COORDINATE", 0);

    const threeDimensional = validInput();
    ring(threeDimensional)[1] = [500_001, 3_700_000, 7];
    expectDatasetError(() => loadBuildingDataset(threeDimensional), "INVALID_COORDINATE", 0);
  });

  it("rejects rings with too few distinct vertices or self-intersections", () => {
    const tooFew = validInput();
    geometryRecord(featureArray(tooFew)[0]).coordinates = [[
      [500_000, 3_700_000],
      [500_001, 3_700_000],
      [500_000, 3_700_000],
      [500_000, 3_700_000],
    ]];
    expectDatasetError(() => loadBuildingDataset(tooFew), "TOO_FEW_VERTICES", 0);

    const bowTie = validInput();
    geometryRecord(featureArray(bowTie)[0]).coordinates = [[
      [500_000, 3_700_000],
      [500_001, 3_700_001],
      [500_001, 3_700_000],
      [500_000, 3_700_001],
      [500_000, 3_700_000],
    ]];
    expectDatasetError(() => loadBuildingDataset(bowTie), "NON_SIMPLE_POLYGON", 0);
  });

  it("reports malformed JSON as a fatal structured error", () => {
    expectDatasetError(() => parseBuildingDatasetText("{not json}"), "JSON_PARSE");
  });
});

function validInput(): MutableJsonRecord {
  return JSON.parse(threeSquaresJson) as MutableJsonRecord;
}

function featureArray(input: MutableJsonRecord): MutableJsonRecord[] {
  return input.features as MutableJsonRecord[];
}

function featureProperties(feature: MutableJsonRecord | undefined): MutableJsonRecord {
  return feature?.properties as MutableJsonRecord;
}

function geometryRecord(feature: MutableJsonRecord | undefined): MutableJsonRecord {
  return feature?.geometry as MutableJsonRecord;
}

function crsProperties(input: MutableJsonRecord): MutableJsonRecord {
  return (input.crs as MutableJsonRecord).properties as MutableJsonRecord;
}

function ring(input: MutableJsonRecord): unknown[] {
  const coordinates = geometryRecord(featureArray(input)[0]).coordinates as unknown[][];
  return coordinates[0] ?? [];
}

function expectDatasetError(
  action: () => unknown,
  code: DatasetErrorCode,
  featureIndex?: number,
): void {
  try {
    action();
    expect.fail(`Expected dataset error ${code}.`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DatasetValidationError);
    expect(error).toMatchObject({ code, featureIndex });
  }
}

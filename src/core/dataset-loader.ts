import Polygon from "@arcgis/core/geometry/Polygon.js";
import * as simplifyOperator from "@arcgis/core/geometry/operators/simplifyOperator.js";
import RBush from "rbush";

import { DatasetValidationError } from "./dataset-errors.js";
import type {
  BuildingDataset,
  BuildingEdge,
  BuildingIndexItem,
  BoundaryIndexItem,
  Coordinate,
  PreparedBuilding,
  VertexIndexItem,
} from "./dataset-types.js";
import { createMeterSpatialReference } from "./spatial-reference.js";

type JsonRecord = Record<string, unknown>;

export function parseBuildingDatasetText(text: string): BuildingDataset {
  let input: unknown;

  try {
    input = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new DatasetValidationError("JSON_PARSE", `Building dataset is not valid JSON.${detail}`);
  }

  return loadBuildingDataset(input);
}

export function loadBuildingDataset(input: unknown): BuildingDataset {
  const root = requireRecord(input, "INVALID_ROOT", "Building dataset must be a JSON object.");

  if (root.type !== "FeatureCollection") {
    throw new DatasetValidationError(
      "UNSUPPORTED_ROOT_TYPE",
      "Building dataset must be a GeoJSON FeatureCollection.",
    );
  }

  const spatialReferenceWkid = parseSpatialReferenceWkid(root.crs);
  let spatialReference;

  try {
    spatialReference = createMeterSpatialReference(spatialReferenceWkid);
  } catch (error: unknown) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new DatasetValidationError(
      "UNSUPPORTED_CRS",
      `Dataset CRS must be a supported projected coordinate system with meter units.${detail}`,
    );
  }

  if (!Array.isArray(root.features)) {
    throw new DatasetValidationError("INVALID_FEATURES", "FeatureCollection.features must be an array.");
  }

  const buildings: PreparedBuilding[] = [];
  const buildingById = new Map<string, PreparedBuilding>();
  const buildingItems: BuildingIndexItem[] = [];
  const boundaryItems: BoundaryIndexItem[] = [];
  const vertexItems: VertexIndexItem[] = [];
  let edgeCount = 0;
  let vertexCount = 0;

  for (const [inputIndex, inputFeature] of root.features.entries()) {
    const building = prepareBuilding(inputFeature, inputIndex, spatialReference);

    if (buildingById.has(building.id)) {
      throw new DatasetValidationError(
        "DUPLICATE_BUILDING_ID",
        `Building ID ${JSON.stringify(building.id)} is duplicated after canonicalization.`,
        { featureIndex: inputIndex, buildingId: building.id },
      );
    }

    buildings.push(building);
    buildingById.set(building.id, building);
    edgeCount += building.edges.length;
    vertexCount += building.vertices.length;
    buildingItems.push(createBuildingIndexItem(building));
    boundaryItems.push(...building.edges.map((edge) => createBoundaryIndexItem(building, edge)));
    vertexItems.push(...building.vertices.map((vertex, vertexIndex) =>
      createVertexIndexItem(building, vertex, vertexIndex)));
  }

  const buildingIndex = new RBush<BuildingIndexItem>();
  buildingIndex.load(buildingItems);
  const boundaryIndex = new RBush<BoundaryIndexItem>();
  boundaryIndex.load(boundaryItems);
  const vertexIndex = new RBush<VertexIndexItem>();
  vertexIndex.load(vertexItems);

  return {
    spatialReference,
    spatialReferenceWkid,
    buildings,
    buildingById,
    buildingIndex,
    boundaryIndex,
    vertexIndex,
    polygonCache: new Map(),
    edgeCount,
    vertexCount,
  };
}

function createBuildingIndexItem(building: PreparedBuilding): BuildingIndexItem {
  return {
    minX: building.extent.xmin,
    minY: building.extent.ymin,
    maxX: building.extent.xmax,
    maxY: building.extent.ymax,
    buildingInputIndex: building.inputIndex,
  };
}

function createBoundaryIndexItem(
  building: PreparedBuilding,
  edge: BuildingEdge,
): BoundaryIndexItem {
  return {
    minX: Math.min(edge.start[0], edge.end[0]),
    minY: Math.min(edge.start[1], edge.end[1]),
    maxX: Math.max(edge.start[0], edge.end[0]),
    maxY: Math.max(edge.start[1], edge.end[1]),
    buildingInputIndex: building.inputIndex,
    edgeIndex: edge.edgeIndex,
  };
}

function createVertexIndexItem(
  building: PreparedBuilding,
  [x, y]: Coordinate,
  vertexIndex: number,
): VertexIndexItem {
  return {
    minX: x,
    minY: y,
    maxX: x,
    maxY: y,
    buildingInputIndex: building.inputIndex,
    vertexIndex,
  };
}

function prepareBuilding(
  input: unknown,
  inputIndex: number,
  spatialReference: ReturnType<typeof createMeterSpatialReference>,
): PreparedBuilding {
  const context = { featureIndex: inputIndex };
  const feature = requireRecord(
    input,
    "INVALID_FEATURE",
    `Feature ${inputIndex} must be a JSON object.`,
    context,
  );

  if (feature.type !== "Feature") {
    throw new DatasetValidationError(
      "INVALID_FEATURE",
      `Feature ${inputIndex} must have type "Feature".`,
      context,
    );
  }

  const properties = requireRecord(
    feature.properties,
    "INVALID_BUILDING_ID",
    `Feature ${inputIndex} must have a properties object containing id.`,
    context,
  );
  const id = canonicalizeBuildingId(properties.id, inputIndex);
  const buildingContext = { featureIndex: inputIndex, buildingId: id };
  const geometry = requireRecord(
    feature.geometry,
    "UNSUPPORTED_GEOMETRY",
    `Building ${JSON.stringify(id)} must have a Polygon geometry.`,
    buildingContext,
  );

  if (geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) {
    throw new DatasetValidationError(
      "UNSUPPORTED_GEOMETRY",
      `Building ${JSON.stringify(id)} must have a Polygon geometry.`,
      buildingContext,
    );
  }

  const geometryCoordinates = geometry.coordinates as unknown[];

  if (geometryCoordinates.length !== 1) {
    throw new DatasetValidationError(
      "HOLES_NOT_ALLOWED",
      `Building ${JSON.stringify(id)} must contain exactly one ring and no holes.`,
      buildingContext,
    );
  }

  const ringInput: unknown = geometryCoordinates[0];
  if (!Array.isArray(ringInput) || ringInput.length < 4) {
    throw new DatasetValidationError(
      "INVALID_RING",
      `Building ${JSON.stringify(id)} must have a ring containing at least four coordinates.`,
      buildingContext,
    );
  }

  const closedRing = ringInput.map((coordinate, coordinateIndex) =>
    parseCoordinate(coordinate, coordinateIndex, buildingContext),
  );
  const first = closedRing[0];
  const last = closedRing.at(-1);

  if (first === undefined || last === undefined || !coordinatesEqual(first, last)) {
    throw new DatasetValidationError(
      "RING_NOT_CLOSED",
      `Building ${JSON.stringify(id)} ring must repeat its first coordinate at the end.`,
      buildingContext,
    );
  }

  const vertices = closedRing.slice(0, -1);
  if (countDistinctCoordinates(vertices) < 3) {
    throw new DatasetValidationError(
      "TOO_FEW_VERTICES",
      `Building ${JSON.stringify(id)} must contain at least three distinct vertices.`,
      buildingContext,
    );
  }

  const orderedRing = signedArea(vertices) > 0 ? [...closedRing].reverse() : closedRing;
  const arcgisRing = orderedRing.map(([x, y]) => [x, y]);
  const polygon = new Polygon({ rings: [arcgisRing], spatialReference });

  if (!simplifyOperator.isSimple(polygon)) {
    throw new DatasetValidationError(
      "NON_SIMPLE_POLYGON",
      `Building ${JSON.stringify(id)} must be a simple polygon.`,
      buildingContext,
    );
  }

  const edges = createEdges(vertices);
  const perimeterMeters = edges.reduce((total, edge) => total + edge.lengthMeters, 0);

  if (!Number.isFinite(perimeterMeters) || perimeterMeters <= 0) {
    throw new DatasetValidationError(
      "ZERO_PERIMETER",
      `Building ${JSON.stringify(id)} must have a finite, nonzero perimeter.`,
      buildingContext,
    );
  }

  const extent = coordinateExtent(vertices);

  return {
    id,
    inputIndex,
    extent,
    vertices,
    edges,
    perimeterMeters,
  };
}

function createEdges(vertices: readonly Coordinate[]): BuildingEdge[] {
  return vertices.map((start, edgeIndex) => {
    const end = vertices[(edgeIndex + 1) % vertices.length];
    if (end === undefined) {
      throw new Error("Validated polygon unexpectedly has no closing edge.");
    }

    return {
      edgeIndex,
      start,
      end,
      lengthMeters: Math.hypot(end[0] - start[0], end[1] - start[1]),
    };
  });
}

function coordinateExtent(vertices: readonly Coordinate[]): PreparedBuilding["extent"] {
  const first = vertices[0];
  if (first === undefined) throw new Error("Validated polygon unexpectedly has no vertices.");
  let xmin = first[0];
  let ymin = first[1];
  let xmax = first[0];
  let ymax = first[1];

  for (const [x, y] of vertices.slice(1)) {
    xmin = Math.min(xmin, x);
    ymin = Math.min(ymin, y);
    xmax = Math.max(xmax, x);
    ymax = Math.max(ymax, y);
  }

  return { xmin, ymin, xmax, ymax };
}

function canonicalizeBuildingId(input: unknown, featureIndex: number): string {
  if (typeof input !== "string" && typeof input !== "number") {
    throw new DatasetValidationError(
      "INVALID_BUILDING_ID",
      `Feature ${featureIndex} must have a string or number properties.id.`,
      { featureIndex },
    );
  }

  if (typeof input === "number" && !Number.isFinite(input)) {
    throw new DatasetValidationError(
      "INVALID_BUILDING_ID",
      `Feature ${featureIndex} properties.id must be finite.`,
      { featureIndex },
    );
  }

  const id = String(input).trim();
  if (id.length === 0) {
    throw new DatasetValidationError(
      "INVALID_BUILDING_ID",
      `Feature ${featureIndex} properties.id must not be empty.`,
      { featureIndex },
    );
  }

  return id;
}

function parseCoordinate(
  input: unknown,
  coordinateIndex: number,
  context: { readonly featureIndex: number; readonly buildingId: string },
): Coordinate {
  if (!Array.isArray(input) || input.length !== 2) {
    throw new DatasetValidationError(
      "INVALID_COORDINATE",
      `Building ${JSON.stringify(context.buildingId)} coordinate ${coordinateIndex} must contain exactly x and y.`,
      context,
    );
  }

  const [x, y] = input as unknown[];
  if (typeof x !== "number" || typeof y !== "number") {
    throw new DatasetValidationError(
      "INVALID_COORDINATE",
      `Building ${JSON.stringify(context.buildingId)} coordinate ${coordinateIndex} must contain numbers.`,
      context,
    );
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new DatasetValidationError(
      "NONFINITE_COORDINATE",
      `Building ${JSON.stringify(context.buildingId)} coordinate ${coordinateIndex} must be finite.`,
      context,
    );
  }

  return [x, y];
}

function parseSpatialReferenceWkid(input: unknown): number {
  if (input === undefined || input === null) {
    throw new DatasetValidationError(
      "MISSING_CRS",
      "Building dataset must declare its projected EPSG coordinate system in a GeoJSON crs member.",
    );
  }

  const crs = requireRecord(input, "INVALID_CRS", "Dataset crs must be an object.");
  const properties = requireRecord(
    crs.properties,
    "INVALID_CRS",
    "Dataset crs.properties must be an object.",
  );

  if (crs.type !== "name" || typeof properties.name !== "string") {
    throw new DatasetValidationError(
      "INVALID_CRS",
      "Dataset crs must use a named EPSG coordinate system.",
    );
  }

  const name = properties.name.trim();
  const patterns = [
    /^EPSG:(\d+)$/i,
    /^urn:ogc:def:crs:EPSG:[^:]*:(\d+)$/i,
    /^https?:\/\/www\.opengis\.net\/def\/crs\/EPSG\/[^/]+\/(\d+)\/?$/i,
    /^https?:\/\/www\.opengis\.net\/gml\/srs\/epsg\.xml#(\d+)$/i,
  ];
  const match = patterns.map((pattern) => pattern.exec(name)).find((candidate) => candidate !== null);
  const wkidText = match?.[1];
  const wkid = wkidText === undefined ? Number.NaN : Number(wkidText);

  if (!Number.isSafeInteger(wkid) || wkid <= 0) {
    throw new DatasetValidationError(
      "INVALID_CRS",
      `Dataset CRS ${JSON.stringify(name)} is not a recognized EPSG name.`,
    );
  }

  return wkid;
}

function countDistinctCoordinates(coordinates: readonly Coordinate[]): number {
  return new Set(coordinates.map(([x, y]) => `${x},${y}`)).size;
}

function coordinatesEqual(left: Coordinate, right: Coordinate): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function signedArea(vertices: readonly Coordinate[]): number {
  const origin = vertices[0];
  if (origin === undefined) return 0;

  let twiceArea = 0;

  for (const [index, current] of vertices.entries()) {
    const next = vertices[(index + 1) % vertices.length];
    if (next !== undefined) {
      const currentX = current[0] - origin[0];
      const currentY = current[1] - origin[1];
      const nextX = next[0] - origin[0];
      const nextY = next[1] - origin[1];
      twiceArea += currentX * nextY - nextX * currentY;
    }
  }

  return twiceArea / 2;
}

function requireRecord(
  input: unknown,
  code: ConstructorParameters<typeof DatasetValidationError>[0],
  message: string,
  context: ConstructorParameters<typeof DatasetValidationError>[2] = {},
): JsonRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new DatasetValidationError(code, message, context);
  }

  return input as JsonRecord;
}

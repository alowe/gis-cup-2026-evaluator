import type Extent from "@arcgis/core/geometry/Extent.js";
import type Polygon from "@arcgis/core/geometry/Polygon.js";
import type Polyline from "@arcgis/core/geometry/Polyline.js";
import type SpatialReference from "@arcgis/core/geometry/SpatialReference.js";

export type Coordinate = readonly [x: number, y: number];

export interface BuildingEdge {
  readonly buildingId: string;
  readonly edgeIndex: number;
  readonly start: Coordinate;
  readonly end: Coordinate;
  readonly lengthMeters: number;
}

export interface PreparedBuilding {
  readonly id: string;
  readonly inputIndex: number;
  readonly polygon: Polygon;
  readonly boundary: Polyline;
  readonly extent: Extent;
  readonly vertices: readonly Coordinate[];
  readonly edges: readonly BuildingEdge[];
  readonly perimeterMeters: number;
}

export interface BuildingDataset {
  readonly spatialReference: SpatialReference;
  readonly spatialReferenceWkid: number;
  readonly buildings: readonly PreparedBuilding[];
  readonly buildingById: ReadonlyMap<string, PreparedBuilding>;
  readonly edgeCount: number;
  readonly vertexCount: number;
}


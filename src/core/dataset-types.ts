import type Polygon from "@arcgis/core/geometry/Polygon.js";
import type SpatialReference from "@arcgis/core/geometry/SpatialReference.js";
import type RBush from "rbush";

export type Coordinate = readonly [x: number, y: number];

export interface BuildingEdge {
  readonly edgeIndex: number;
  readonly start: Coordinate;
  readonly end: Coordinate;
  readonly lengthMeters: number;
}

export interface BoundaryIndexItem {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly buildingInputIndex: number;
  readonly edgeIndex: number;
}

export interface BuildingIndexItem {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly buildingInputIndex: number;
}

export interface VertexIndexItem {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly buildingInputIndex: number;
  readonly vertexIndex: number;
}

export interface BuildingExtent {
  readonly xmin: number;
  readonly ymin: number;
  readonly xmax: number;
  readonly ymax: number;
}

export interface PreparedBuilding {
  readonly id: string;
  readonly inputIndex: number;
  readonly extent: BuildingExtent;
  readonly vertices: readonly Coordinate[];
  readonly edges: readonly BuildingEdge[];
  readonly perimeterMeters: number;
}

export interface BuildingDataset {
  readonly spatialReference: SpatialReference;
  readonly spatialReferenceWkid: number;
  readonly buildings: readonly PreparedBuilding[];
  readonly buildingById: ReadonlyMap<string, PreparedBuilding>;
  readonly buildingIndex: RBush<BuildingIndexItem>;
  readonly boundaryIndex: RBush<BoundaryIndexItem>;
  readonly vertexIndex: RBush<VertexIndexItem>;
  readonly polygonCache: Map<number, Polygon>;
  readonly edgeCount: number;
  readonly vertexCount: number;
}

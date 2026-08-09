import Polygon from "@arcgis/core/geometry/Polygon.js";
import * as relateOperator from "@arcgis/core/geometry/operators/relateOperator.js";

import type { BuildingDataset, PreparedBuilding } from "./dataset-types.js";

const MAX_CACHED_POLYGONS = 512;

export function getBuildingPolygon(
  dataset: BuildingDataset,
  building: PreparedBuilding,
): Polygon {
  const cached = dataset.polygonCache.get(building.inputIndex);
  if (cached !== undefined) {
    dataset.polygonCache.delete(building.inputIndex);
    dataset.polygonCache.set(building.inputIndex, cached);
    return cached;
  }

  const vertices = signedArea(building.vertices) > 0
    ? [...building.vertices].reverse()
    : building.vertices;
  const first = vertices[0];
  if (first === undefined) throw new Error("Prepared building unexpectedly has no vertices.");
  const ring = [...vertices, first].map(([x, y]) => [x, y]);
  const polygon = new Polygon({ rings: [ring], spatialReference: dataset.spatialReference });
  relateOperator.accelerateGeometry(polygon);
  dataset.polygonCache.set(building.inputIndex, polygon);

  if (dataset.polygonCache.size > MAX_CACHED_POLYGONS) {
    const oldestKey = dataset.polygonCache.keys().next().value;
    if (oldestKey !== undefined) dataset.polygonCache.delete(oldestKey);
  }

  return polygon;
}

function signedArea(vertices: readonly (readonly [number, number])[]): number {
  const origin = vertices[0];
  if (origin === undefined) return 0;
  let twiceArea = 0;

  for (const [index, current] of vertices.entries()) {
    const next = vertices[(index + 1) % vertices.length];
    if (next !== undefined) {
      twiceArea += (current[0] - origin[0]) * (next[1] - origin[1])
        - (next[0] - origin[0]) * (current[1] - origin[1]);
    }
  }

  return twiceArea / 2;
}

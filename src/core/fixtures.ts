import Point from "@arcgis/core/geometry/Point.js";
import Polygon from "@arcgis/core/geometry/Polygon.js";
import type SpatialReference from "@arcgis/core/geometry/SpatialReference.js";

export function unitSquare(
  xmin: number,
  ymin: number,
  spatialReference: SpatialReference,
): Polygon {
  return new Polygon({
    rings: [[
      [xmin, ymin],
      [xmin, ymin + 1],
      [xmin + 1, ymin + 1],
      [xmin + 1, ymin],
      [xmin, ymin],
    ]],
    spatialReference,
  });
}

export function point(x: number, y: number, spatialReference: SpatialReference): Point {
  return new Point({ x, y, spatialReference });
}

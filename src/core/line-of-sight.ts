import Point from "@arcgis/core/geometry/Point.js";
import Polygon from "@arcgis/core/geometry/Polygon.js";
import Polyline from "@arcgis/core/geometry/Polyline.js";
import * as relateOperator from "@arcgis/core/geometry/operators/relateOperator.js";

/** Tests the contest's blocking rule: only an interior/interior intersection blocks. */
export function isBlockedByPolygon(start: Point, end: Point, obstacle: Polygon): boolean {
  if (!start.spatialReference.equals(end.spatialReference)) {
    throw new Error("Sight-line endpoints must use the same spatial reference.");
  }

  if (!start.spatialReference.equals(obstacle.spatialReference)) {
    throw new Error("Sight line and obstacle must use the same spatial reference.");
  }

  const sightLine = new Polyline({
    paths: [[[start.x, start.y], [end.x, end.y]]],
    spatialReference: start.spatialReference,
  });

  return relateOperator.execute(sightLine, obstacle, "T********");
}


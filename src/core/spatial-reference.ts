import SpatialReference from "@arcgis/core/geometry/SpatialReference.js";

import { SPATIAL_TOLERANCE_METERS } from "./constants.js";

export function createMeterSpatialReference(wkid: number): SpatialReference {
  const spatialReference = new SpatialReference({
    wkid,
    xyTolerance: SPATIAL_TOLERANCE_METERS,
  });

  if (spatialReference.isGeographic || spatialReference.unit !== "meters") {
    throw new Error(`WKID ${wkid} is not a projected, meter-based spatial reference.`);
  }

  return spatialReference;
}


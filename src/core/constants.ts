import packageMetadata from "../../package.json";

export const SPATIAL_TOLERANCE_METERS = 0.001;
export const DISTANCE_TIE_TOLERANCE_METERS = 1e-9;
export const TEST_SPATIAL_REFERENCE_WKID = 32611;
export const EVALUATOR_VERSION = packageMetadata.version;
export const ARCGIS_VERSION = packageMetadata.dependencies["@arcgis/core"];

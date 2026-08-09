export type DatasetErrorCode =
  | "JSON_PARSE"
  | "INVALID_ROOT"
  | "UNSUPPORTED_ROOT_TYPE"
  | "MISSING_CRS"
  | "INVALID_CRS"
  | "UNSUPPORTED_CRS"
  | "INVALID_FEATURES"
  | "INVALID_FEATURE"
  | "INVALID_BUILDING_ID"
  | "DUPLICATE_BUILDING_ID"
  | "UNSUPPORTED_GEOMETRY"
  | "HOLES_NOT_ALLOWED"
  | "INVALID_RING"
  | "RING_NOT_CLOSED"
  | "TOO_FEW_VERTICES"
  | "INVALID_COORDINATE"
  | "NONFINITE_COORDINATE"
  | "ZERO_PERIMETER"
  | "NON_SIMPLE_POLYGON";

export interface DatasetErrorContext {
  readonly featureIndex?: number;
  readonly buildingId?: string;
}

export class DatasetValidationError extends Error {
  readonly code: DatasetErrorCode;
  readonly featureIndex?: number;
  readonly buildingId?: string;

  constructor(code: DatasetErrorCode, message: string, context: DatasetErrorContext = {}) {
    super(message);
    this.name = "DatasetValidationError";
    this.code = code;
    this.featureIndex = context.featureIndex;
    this.buildingId = context.buildingId;
  }
}


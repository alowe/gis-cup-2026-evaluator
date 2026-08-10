# Browser test data

## Full sample

Load these two files in order:

1. `GIS-cup-sample-dataset.geojson`
2. `GIS-cup-sample-submission.txt`

The submission places one antenna at a vertex of building `1` and claims that building at `tau=0.1`. Its computed coverage is `0.5`, so the expected verified service score is `1`.

The sample dataset was synthesized from Microsoft Global ML Building Footprints data. See [NOTICE.md](NOTICE.md) for its provenance and the accompanying CDLA-Permissive-2.0 terms.

## Small smoke tests

The `ui-smoke` folder contains a one-building synthetic dataset and several submissions covering common success, failure, warning, and multiple-configuration paths. See `ui-smoke/README.md` for expected results.

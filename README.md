# GIS Cup Evaluator

Browser-local contestant self-checker for the SIGSPATIAL 2026 GIS Cup. The application will validate antenna locations and calculate continuously visible building-perimeter intervals using the ArcGIS Maps SDK for JavaScript.

## Development

```sh
pnpm install
pnpm test
pnpm build
pnpm dev
pnpm benchmark:sample
```

The authoritative spatial tolerance is `0.001` meters. It is applied through the ArcGIS spatial reference and geometry operators as numerical/topological slack; it is not interpreted as an exact maximum-penetration distance. Dependencies are pinned exactly in `package.json` and `pnpm-lock.yaml` so the resulting geometry behavior can be reproduced.

## Architecture

- `src/core`: UI-independent parsing and geometry evaluation
- `src/worker`: browser worker protocol and evaluator entry point
- `src/main.ts`: browser UI

The initial test milestone characterizes ArcGIS line-of-sight behavior near the specified spatial tolerance, including boundary overlap, vertex contact, small nominal penetrations, and clear interior crossings.

The dataset loader accepts a named EPSG CRS, requires projected meter units, canonicalizes building IDs, and rejects unsupported geometry, holes, malformed coordinates, open or self-intersecting rings, and duplicate IDs. Valid polygons are stored as compact coordinates, edges, extents, and planar perimeters inside the worker. ArcGIS polygons are created and accelerated on demand in a bounded least-recently-used cache, avoiding one heavyweight geometry object per building.

The solution parser accepts any number of independent three-line configurations. It preserves blank antenna and claim lists, supports decimal and scientific notation, truncates to the first `k` reported antenna entries before validation, and returns structured warnings for invalid parameters and retained entries.

Dataset-aware validation uses an R-tree of boundary edges to find nearby segments, then calculates the exact nearest point on each candidate segment. Equal-distance candidates use canonical building ID and input order as deterministic tie-breakers. Duplicate and unknown claims are resolved without changing submission order, and duplicate snapped antennas are retained for `k` accounting but reduced to unique evaluation positions.

The production visibility engine uses the same global radial-sweep algorithm for every evaluation, independent of claim count. For each antenna, building-edge endpoint angles partition the plane into open angular slabs. A deterministic active-edge treap tracks the front boundary by ray-intersection distance; the guaranteed non-overlap of building footprints means active edges cannot exchange order inside a slab. Every building remains an obstacle, while visible intervals are recorded only for claimed buildings. Intervals are unioned across antennas without double-counting, and scoring compares visible length directly with `tau * perimeter`; equality is serviced.

Collinear radial target edges, target footprints within the spatial tolerance of an antenna, and other zero-width angular degeneracies use the ArcGIS-backed critical-parameter edge classifier. The sweep also detects tolerance-sensitive slabs when the front boundaries are close along the ray or the ray passes close to their shared vertex. It then uses ArcGIS interior/interior DE-9IM tests, at the same edge-parameter midpoint used by the reference classifier, to decide which boundaries remain visible. The detection envelope is deliberately conservative; it does not redefine the `0.001` m tolerance or impose a fixed penetration rule.

Normal scoring removes a verified building from subsequent antenna work once accumulated visible length reaches its threshold and reports lower-bound coverage. Full diagnostic mode processes every antenna and reports complete coverage. Identical antenna/threshold configurations share visibility results across solution blocks. The worker emits per-antenna sweep progress followed by per-claim result progress, yields periodically within large sweeps for responsive cancellation, and exports a versioned JSON report containing input SHA-256 hashes, pinned geometry versions, detailed counts, verified IDs, coverage results, and structured warnings.

The sample benchmark loads `datasets/GIS-cup-sample-dataset.geojson` by default and reports file, geometry, time, heap, and one-antenna radial-sweep statistics. `BENCHMARK_CLAIMS` controls how many nearby buildings have their visible intervals recorded; all dataset edges participate as obstacles regardless. Override the input with `SAMPLE_DATASET` when testing larger data.

Ready-to-load browser fixtures are under `datasets/ui-smoke`, with documented expected scores for passing, failing, snapping, duplicate, unknown-ID, truncation, and multi-configuration cases. `datasets/GIS-cup-sample-submission.txt` provides a quick submission for the larger committed sample dataset.

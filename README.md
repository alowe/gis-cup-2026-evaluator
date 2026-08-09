# GIS Cup Evaluator

Browser-local contestant self-checker for the SIGSPATIAL 2026 GIS Cup. The application will validate antenna locations and calculate continuously visible building-perimeter intervals using the ArcGIS Maps SDK for JavaScript.

## Development

```sh
pnpm install
pnpm test
pnpm build
pnpm dev
```

The authoritative spatial tolerance is `0.001` meters. It is applied through the ArcGIS spatial reference and geometry operators as numerical/topological slack; it is not interpreted as an exact maximum-penetration distance. Dependencies are pinned exactly in `package.json` and `pnpm-lock.yaml` so the resulting geometry behavior can be reproduced.

## Architecture

- `src/core`: UI-independent parsing and geometry evaluation
- `src/worker`: browser worker protocol and evaluator entry point
- `src/main.ts`: browser UI

The initial test milestone characterizes ArcGIS line-of-sight behavior near the specified spatial tolerance, including boundary overlap, vertex contact, small nominal penetrations, and clear interior crossings.

The dataset loader accepts a named EPSG CRS, requires projected meter units, canonicalizes building IDs, and rejects unsupported geometry, holes, malformed coordinates, open or self-intersecting rings, and duplicate IDs. Valid polygons are converted to ArcGIS geometries and preprocessed into boundaries, edges, vertices, extents, and planar perimeters inside the worker.

The solution parser accepts any number of independent three-line configurations. It preserves blank antenna and claim lists, supports decimal and scientific notation, truncates to the first `k` reported antenna entries before validation, and returns structured warnings for invalid parameters and retained entries.

Dataset-aware validation uses an R-tree of boundary edges to find nearby buildings, then uses ArcGIS proximity operations for authoritative boundary distance and snapping. Equal-distance candidates use canonical building ID and input order as deterministic tie-breakers. Duplicate and unknown claims are resolved without changing submission order, and duplicate snapped antennas are retained for `k` accounting but reduced to unique evaluation positions.

The visibility engine generates critical parameters where antenna rays pass through indexed building vertices, classifies each resulting open edge interval with ArcGIS interior/interior DE-9IM tests, and unions visible intervals across antennas without double-counting. Scoring evaluates only unique known claimed buildings and compares visible length directly with `tau * perimeter`; equality is serviced.

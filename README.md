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

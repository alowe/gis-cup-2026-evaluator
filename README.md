# Competition information

On August 15th, 16:00 UTC the official competition dataset and parameters will be available at the following files

```text
datasets/GIS-cup-competition-dataset.geojson
datasets/competition-parameters.txt
```

Full instructions can be found at the [SIGSPATIAL website.](https://sigspatial2026.sigspatial.org/giscup.html)

# GIS Cup Evaluator

Browser-based contestant self-checker for the SIGSPATIAL 2026 GIS Cup. It validates antenna placements, measures the visible perimeter of claimed buildings, and reports the resulting service score.

All evaluation runs locally in the browser. Dataset and submission files are not uploaded or sent to a server.

## Using the evaluator

1. Open the hosted evaluator or start it locally.
2. Select the competition building dataset (`.geojson`).
3. Select a contestant submission (`.txt`).
4. Review the service score, verified claims, and any validation warnings.
5. Optionally download the detailed JSON report.

The JSON report records input hashes, evaluator and geometry-library versions, validation details, and per-building coverage results so that an evaluation can be reproduced.

## Input files

The building dataset must be a GeoJSON `FeatureCollection` with:

- a named EPSG projected coordinate reference system using meters;
- one non-overlapping `Polygon` feature per building; and
- a unique `properties.id` value for every building.

Each submission configuration occupies three lines:

```text
(tau, k)
(x1, y1), (x2, y2), ...
building-id-1, building-id-2, ...
```

Here, `tau` is the required visible fraction of a building's perimeter and `k` is the number of submitted antennas. A file may contain multiple consecutive three-line configurations.

Ready-to-load examples and their expected results are available in [`datasets`](datasets/README.md).

## Evaluation behavior

An antenna must lie on a building boundary, subject to the evaluator's spatial tolerance. A claimed building is serviced when the union of its perimeter visible from the valid submitted antennas is at least `tau` times its total perimeter. Perimeter intervals visible from multiple antennas are counted only once.

The authoritative spatial tolerance is `0.001` meters. ArcGIS geometry operations apply this as numerical and topological slack; it should not be interpreted as an exact maximum-penetration distance.

The evaluator uses one global radial-sweep visibility algorithm for all evaluations, with ArcGIS-backed handling for tolerance-sensitive and degenerate cases. All buildings participate as visibility obstacles, whether or not they are claimed.

## Running locally

Install Node.js LTS and pnpm, then run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local address printed by Vite. Opening `index.html` directly is not supported because the application uses browser modules and a web worker.

## Development

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Dependencies are pinned in `package.json` and `pnpm-lock.yaml` to keep geometry behavior reproducible. The evaluator and ArcGIS versions shown in the interface and JSON reports are derived from that package metadata.

Pushes to `main` or `master` run the full validation suite and deploy the production build through GitHub Pages. The workflow derives the standard `/<repository-name>/` base path automatically; local development continues to use `/`.

The main source directories are:

- `src/core`: parsing, validation, visibility, and scoring;
- `src/worker`: background evaluation and report generation; and
- `src/main.ts`: browser interface.

## Licensing

The original evaluator software is available under the [MIT License](LICENSE).

`datasets/GIS-cup-sample-dataset.geojson` is derived from Microsoft's Global ML Building Footprints data and remains subject to the [Community Data License Agreement - Permissive, Version 2.0](datasets/CDLA-Permissive-2.0.txt). See the [dataset provenance notice](datasets/NOTICE.md) for details.

Third-party dependencies retain their own license terms. See [Third-party notices](THIRD_PARTY_NOTICES.md), including the separate terms applicable to the ArcGIS Maps SDK for JavaScript.

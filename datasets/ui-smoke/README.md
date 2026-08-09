# UI smoke-test fixtures

Load `buildings.geojson` in the evaluator, then load any of the numbered `.txt` submissions.

| Submission | Expected result |
| --- | --- |
| `01-pass-exact-threshold.txt` | `target` passes with coverage exactly `0.5`. |
| `02-fail-above-threshold.txt` | `target` fails because `0.5 < 0.500001`. |
| `03-pass-with-snap.txt` | The antenna snaps `0.0005` m to the lower-left corner and `target` passes. |
| `04-invalid-off-boundary.txt` | The antenna is rejected at `0.002` m from the boundary; the claim fails. |
| `05-duplicates-and-unknown-claims.txt` | The duplicate antenna is reused, the duplicate claim is counted once, `missing` is ignored, and `target` passes. |
| `06-multiple-configurations.txt` | Scores are `1`, `0`, and `0`. The third block demonstrates first-`k` truncation: its valid second antenna is not used to replace the invalid first one. |

These fixtures intentionally use a projected meter CRS and coordinates resembling UTM values. Unless otherwise noted, ordinary scoring may report lower-bound coverage because evaluation stops as soon as the threshold is reached. Enable **Full diagnostic coverage** to force complete perimeter calculation.

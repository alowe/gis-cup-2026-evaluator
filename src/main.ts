import "./style.css";
import type {
  EvaluatorWorkerRequest,
  EvaluatorWorkerResponse,
  SubproblemValidationSummary,
} from "./worker/messages.js";

const app = document.querySelector<HTMLElement>("#app");

if (app === null) {
  throw new Error("Application root was not found.");
}

app.innerHTML = `
  <section class="shell">
    <p class="eyebrow">SIGSPATIAL 2026 GIS Cup</p>
    <h1>Submission evaluator</h1>
    <p class="lede">
      A browser-local checker for antenna placement and visible building perimeter.
      Dataset and solution files remain on this machine.
    </p>
    <section class="panel" aria-labelledby="dataset-heading">
      <div>
        <p class="step">Step 1</p>
        <h2 id="dataset-heading">Load building footprints</h2>
        <p class="hint">Projected, meter-based GeoJSON · Polygon features · one ring per building</p>
      </div>
      <label class="file-picker">
        <span>Choose GeoJSON</span>
        <input data-dataset-input type="file" accept=".geojson,.json,application/geo+json,application/json" />
      </label>
    </section>
    <section class="panel" aria-labelledby="solution-heading">
      <div>
        <p class="step">Step 2</p>
        <h2 id="solution-heading">Validate a solution</h2>
        <p class="hint">One or more three-line configurations · validation uses the loaded dataset</p>
      </div>
      <label class="file-picker" data-solution-picker>
        <span>Choose solution</span>
        <input data-solution-input type="file" accept=".txt,text/plain" disabled />
      </label>
    </section>
    <div class="status" data-status>Starting geometry worker…</div>
    <div class="results" data-results hidden></div>
  </section>
`;

const status = document.querySelector<HTMLElement>("[data-status]");
const datasetInput = document.querySelector<HTMLInputElement>("[data-dataset-input]");
const solutionInput = document.querySelector<HTMLInputElement>("[data-solution-input]");
const results = document.querySelector<HTMLElement>("[data-results]");

if (status === null || datasetInput === null || solutionInput === null || results === null) {
  throw new Error("Required evaluator controls were not found.");
}

const evaluatorWorker = new Worker(
  new URL("./worker/evaluator.worker.ts", import.meta.url),
  { type: "module" },
);

evaluatorWorker.addEventListener(
  "message",
  (event: MessageEvent<EvaluatorWorkerResponse>) => {
    switch (event.data.type) {
      case "ready":
        status.textContent = `Geometry worker ready · ${event.data.spatialToleranceMeters} m spatial tolerance`;
        break;
      case "dataset-loaded": {
        if (event.data.requestId !== activeDatasetRequestId) return;
        const summary = event.data.summary;
        datasetInput.disabled = false;
        solutionInput.disabled = false;
        status.dataset.state = "success";
        status.textContent = `${summary.fileName}: ${summary.buildingCount.toLocaleString()} buildings, ${summary.vertexCount.toLocaleString()} vertices · EPSG:${summary.spatialReferenceWkid}`;
        break;
      }
      case "dataset-error":
        if (event.data.requestId !== activeDatasetRequestId) return;
        datasetInput.disabled = false;
        solutionInput.disabled = true;
        status.dataset.state = "error";
        status.textContent = `${event.data.error.code}: ${event.data.error.message}`;
        break;
      case "solution-validated":
        if (event.data.requestId !== activeSolutionRequestId) return;
        solutionInput.disabled = false;
        status.dataset.state = "success";
        status.textContent = `${event.data.summary.fileName}: ${event.data.summary.subproblems.length} configuration(s), ${event.data.summary.warningCount} warning(s)`;
        renderSolutionSummary(results, event.data.summary.subproblems);
        break;
      case "solution-error":
        if (event.data.requestId !== activeSolutionRequestId) return;
        solutionInput.disabled = false;
        status.dataset.state = "error";
        status.textContent = `${event.data.error.code}: ${event.data.error.message}`;
        break;
    }
  },
);

evaluatorWorker.addEventListener("error", () => {
  status.textContent = "Geometry worker failed to start.";
  status.dataset.state = "error";
});

const request: EvaluatorWorkerRequest = { type: "ping" };
evaluatorWorker.postMessage(request);

let activeDatasetRequestId = 0;
let activeSolutionRequestId = 0;

datasetInput.addEventListener("change", () => {
  const file = datasetInput.files?.[0];
  if (file === undefined) return;

  activeDatasetRequestId += 1;
  datasetInput.disabled = true;
  solutionInput.disabled = true;
  results.hidden = true;
  delete status.dataset.state;
  status.textContent = `Validating ${file.name}…`;

  const loadRequest: EvaluatorWorkerRequest = {
    type: "load-dataset",
    requestId: activeDatasetRequestId,
    file,
  };
  evaluatorWorker.postMessage(loadRequest);
});

solutionInput.addEventListener("change", () => {
  const file = solutionInput.files?.[0];
  if (file === undefined) return;

  activeSolutionRequestId += 1;
  solutionInput.disabled = true;
  results.hidden = true;
  delete status.dataset.state;
  status.textContent = `Validating ${file.name}…`;

  const loadRequest: EvaluatorWorkerRequest = {
    type: "load-solution",
    requestId: activeSolutionRequestId,
    file,
  };
  evaluatorWorker.postMessage(loadRequest);
});

function renderSolutionSummary(
  container: HTMLElement,
  subproblems: readonly SubproblemValidationSummary[],
): void {
  container.replaceChildren();

  const table = document.createElement("table");
  const header = document.createElement("thead");
  header.innerHTML = "<tr><th>Configuration</th><th>τ</th><th>k</th><th>Antennas</th><th>Claims</th><th>Score</th><th>Warnings</th></tr>";
  table.append(header);

  const body = document.createElement("tbody");
  for (const subproblem of subproblems) {
    const row = document.createElement("tr");
    const values = [
      String(subproblem.index),
      subproblem.tau?.toString() ?? "Invalid",
      subproblem.k?.toString() ?? "Invalid",
      `${subproblem.validAntennaCount}/${subproblem.reportedAntennaCount} valid`,
      `${subproblem.uniqueKnownClaimCount}/${subproblem.reportedClaimCount} known`,
      String(subproblem.verifiedServiceScore),
      String(subproblem.warningCount),
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }

  table.append(body);
  container.append(table);
  container.hidden = false;
}

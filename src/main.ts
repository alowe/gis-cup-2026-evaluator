import "./style.css";
import type {
  EvaluatorWorkerRequest,
  EvaluatorWorkerResponse,
  SubproblemValidationSummary,
} from "./worker/messages.js";
import type { EvaluationReport } from "./core/report-types.js";

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
    <div class="evaluation-options">
      <label><input data-full-coverage type="checkbox" /> Compute full diagnostic coverage</label>
      <div class="actions">
        <button data-cancel type="button" disabled>Cancel</button>
        <button data-export type="button" disabled>Download JSON report</button>
      </div>
    </div>
    <div class="status" data-status>Starting geometry worker…</div>
    <div class="results" data-results hidden></div>
  </section>
`;

const status = document.querySelector<HTMLElement>("[data-status]");
const datasetInput = document.querySelector<HTMLInputElement>("[data-dataset-input]");
const solutionInput = document.querySelector<HTMLInputElement>("[data-solution-input]");
const results = document.querySelector<HTMLElement>("[data-results]");
const fullCoverageInput = document.querySelector<HTMLInputElement>("[data-full-coverage]");
const cancelButton = document.querySelector<HTMLButtonElement>("[data-cancel]");
const exportButton = document.querySelector<HTMLButtonElement>("[data-export]");

if (
  status === null
  || datasetInput === null
  || solutionInput === null
  || results === null
  || fullCoverageInput === null
  || cancelButton === null
  || exportButton === null
) {
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
        exportButton.disabled = true;
        latestReport = undefined;
        status.dataset.state = "success";
        status.textContent = `${summary.fileName}: ${summary.buildingCount.toLocaleString()} buildings, ${summary.vertexCount.toLocaleString()} vertices · EPSG:${summary.spatialReferenceWkid}`;
        break;
      }
      case "dataset-error":
        if (event.data.requestId !== activeDatasetRequestId) return;
        datasetInput.disabled = false;
        solutionInput.disabled = true;
        exportButton.disabled = true;
        latestReport = undefined;
        status.dataset.state = "error";
        status.textContent = `${event.data.error.code}: ${event.data.error.message}`;
        break;
      case "solution-validated":
        if (event.data.requestId !== activeSolutionRequestId) return;
        solutionInput.disabled = false;
        cancelButton.disabled = true;
        exportButton.disabled = false;
        latestReport = event.data.report;
        status.dataset.state = "success";
        status.textContent = `${event.data.summary.fileName}: ${event.data.summary.subproblems.length} configuration(s), ${event.data.summary.warningCount} warning(s)`;
        renderSolutionSummary(results, event.data.summary.subproblems, event.data.report);
        break;
      case "solution-error":
        if (event.data.requestId !== activeSolutionRequestId) return;
        solutionInput.disabled = false;
        cancelButton.disabled = true;
        status.dataset.state = "error";
        status.textContent = `${event.data.error.code}: ${event.data.error.message}`;
        break;
      case "evaluation-progress":
        if (event.data.requestId !== activeSolutionRequestId) return;
        status.textContent = `Configuration ${event.data.subproblemIndex}: evaluated ${event.data.completedBuildingCount}/${event.data.totalBuildingCount} claims · ${event.data.buildingId}`;
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
let latestReport: EvaluationReport | undefined;

datasetInput.addEventListener("change", () => {
  const file = datasetInput.files?.[0];
  if (file === undefined) return;

  activeDatasetRequestId += 1;
  activeSolutionRequestId += 1;
  datasetInput.disabled = true;
  solutionInput.disabled = true;
  cancelButton.disabled = true;
  results.hidden = true;
  exportButton.disabled = true;
  latestReport = undefined;
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
  cancelButton.disabled = false;
  exportButton.disabled = true;
  latestReport = undefined;
  results.hidden = true;
  delete status.dataset.state;
  status.textContent = `Validating ${file.name}…`;

  const loadRequest: EvaluatorWorkerRequest = {
    type: "load-solution",
    requestId: activeSolutionRequestId,
    file,
    fullDiagnosticCoverage: fullCoverageInput.checked,
  };
  evaluatorWorker.postMessage(loadRequest);
});

cancelButton.addEventListener("click", () => {
  const cancelRequest: EvaluatorWorkerRequest = {
    type: "cancel-evaluation",
    requestId: activeSolutionRequestId,
  };
  evaluatorWorker.postMessage(cancelRequest);
  cancelButton.disabled = true;
  status.textContent = "Cancelling evaluation…";
});

exportButton.addEventListener("click", () => {
  if (latestReport === undefined) return;

  const blob = new Blob([`${JSON.stringify(latestReport, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${stripFileExtension(latestReport.solution.fileName)}.evaluation.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

function renderSolutionSummary(
  container: HTMLElement,
  subproblems: readonly SubproblemValidationSummary[],
  report: EvaluationReport,
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
      `${subproblem.verifiedServiceScore}/${subproblem.reportedClaimCount} valid`,
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
  renderWarningDetails(container, report);
  container.hidden = false;
}

function renderWarningDetails(container: HTMLElement, report: EvaluationReport): void {
  const warningCount = report.subproblems.reduce(
    (total, subproblem) => total + subproblem.warnings.length,
    0,
  );
  if (warningCount === 0) return;

  const details = document.createElement("details");
  details.className = "warning-details";
  const summary = document.createElement("summary");
  summary.textContent = `View ${warningCount} warning${warningCount === 1 ? "" : "s"}`;
  details.append(summary);

  const warningList = document.createElement("div");
  warningList.className = "warning-list";
  for (const subproblem of report.subproblems) {
    if (subproblem.warnings.length === 0) continue;

    const group = document.createElement("section");
    group.className = "warning-group";
    const heading = document.createElement("h3");
    heading.textContent = `Configuration ${subproblem.index}`;
    group.append(heading);

    for (const warning of subproblem.warnings) {
      const item = document.createElement("article");
      item.className = "warning-item";
      const title = document.createElement("div");
      title.className = "warning-code";
      title.textContent = warningContext(warning);
      const message = document.createElement("p");
      message.textContent = warning.message;
      const action = document.createElement("p");
      action.className = "warning-action";
      action.textContent = `Action: ${warning.action}`;
      item.append(title, message, action);
      group.append(item);
    }
    warningList.append(group);
  }

  details.append(warningList);
  container.append(details);
}

function warningContext(warning: EvaluationReport["subproblems"][number]["warnings"][number]): string {
  const context: string[] = [warning.code];
  if (warning.buildingId !== undefined) context.push(`building ${warning.buildingId}`);
  if (warning.entryIndex !== undefined) context.push(`entry ${warning.entryIndex}`);
  return context.join(" · ");
}

function stripFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

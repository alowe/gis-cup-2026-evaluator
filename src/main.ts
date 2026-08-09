import "./style.css";
import type { EvaluatorWorkerRequest, EvaluatorWorkerResponse } from "./worker/messages.js";

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
    <div class="status" data-status>Starting geometry worker…</div>
  </section>
`;

const status = document.querySelector<HTMLElement>("[data-status]");
const datasetInput = document.querySelector<HTMLInputElement>("[data-dataset-input]");

if (status === null || datasetInput === null) {
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
        if (event.data.requestId !== activeRequestId) return;
        const summary = event.data.summary;
        datasetInput.disabled = false;
        status.dataset.state = "success";
        status.textContent = `${summary.fileName}: ${summary.buildingCount.toLocaleString()} buildings, ${summary.vertexCount.toLocaleString()} vertices · EPSG:${summary.spatialReferenceWkid}`;
        break;
      }
      case "dataset-error":
        if (event.data.requestId !== activeRequestId) return;
        datasetInput.disabled = false;
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

let activeRequestId = 0;

datasetInput.addEventListener("change", () => {
  const file = datasetInput.files?.[0];
  if (file === undefined) return;

  activeRequestId += 1;
  datasetInput.disabled = true;
  delete status.dataset.state;
  status.textContent = `Validating ${file.name}…`;

  const loadRequest: EvaluatorWorkerRequest = {
    type: "load-dataset",
    requestId: activeRequestId,
    file,
  };
  evaluatorWorker.postMessage(loadRequest);
});

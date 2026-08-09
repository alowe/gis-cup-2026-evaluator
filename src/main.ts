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
    <div class="status" data-status>Starting geometry worker…</div>
  </section>
`;

const status = document.querySelector<HTMLElement>("[data-status]");

if (status === null) {
  throw new Error("Worker status element was not found.");
}

const evaluatorWorker = new Worker(
  new URL("./worker/evaluator.worker.ts", import.meta.url),
  { type: "module" },
);

evaluatorWorker.addEventListener(
  "message",
  (event: MessageEvent<EvaluatorWorkerResponse>) => {
    if (event.data.type === "ready") {
      status.textContent = `Geometry worker ready · ${event.data.spatialToleranceMeters} m spatial tolerance`;
    }
  },
);

evaluatorWorker.addEventListener("error", () => {
  status.textContent = "Geometry worker failed to start.";
  status.dataset.state = "error";
});

const request: EvaluatorWorkerRequest = { type: "ping" };
evaluatorWorker.postMessage(request);

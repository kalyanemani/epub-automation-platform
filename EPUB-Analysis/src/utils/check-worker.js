const path = require("path");
const { parentPort, workerData } = require("worker_threads");

require("dotenv").config({ path: path.join(__dirname, "../../.env") });

(async () => {
  try {
    const { modulePath, exportName, context } = workerData || {};
    const loadedModule = require(modulePath);
    const workerFn = exportName ? loadedModule?.[exportName] : loadedModule;

    if (typeof workerFn !== "function") {
      throw new Error(`Worker export "${exportName || "default"}" is not callable.`);
    }

    const result = await workerFn(context || {});
    parentPort.postMessage({
      type: "done",
      result: Array.isArray(result) ? result : result || [],
    });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      error: error?.message || "Unknown worker error",
      stack: error?.stack || "",
    });
  }
})();

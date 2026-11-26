// Python runs here, off the page's main thread, so the page stays responsive and a runaway query can be stopped by
// ending this worker. Pyodide and its packages come from this App's own pyodide/ folder (see vite.config.ts).
import type {PyodideAPI} from "pyodide";
import siftSource from "./sift.py?raw";
import type {FromWorker, ToWorker} from "./protocol";

let python: Promise<PyodideAPI> | null = null;

function post(message: FromWorker, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(message, transfer);
}

async function start(indexURL: string): Promise<PyodideAPI> {
  post({type: "stage", stage: "runtime"});
  const {loadPyodide} = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as typeof import("pyodide");
  // packageBaseUrl set explicitly: without it Pyodide would fall back to its CDN (jsDelivr) for packages.
  const pyodide = await loadPyodide({indexURL, packageBaseUrl: indexURL, stdout: () => {}, stderr: () => {}});
  post({type: "stage", stage: "packages"});
  await pyodide.loadPackage(["pandas"], {messageCallback: () => {}, errorCallback: () => {}});
  pyodide.runPython(siftSource);
  post({type: "stage", stage: "ready"});
  return pyodide;
}

function call(pyodide: PyodideAPI, name: string, ...args: unknown[]): string {
  const fn = pyodide.globals.get(name);
  try {
    return fn(...args) as string;
  } finally {
    fn.destroy();
  }
}

self.addEventListener("message", async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "init") {
    python = start(message.indexURL);
    python.catch((error: unknown) => post({type: "fatal", message: error instanceof Error ? error.message : String(error)}));
    return;
  }
  if (!python) return;
  let pyodide: PyodideAPI;
  try {
    pyodide = await python;
  } catch {
    return;
  }
  try {
    const started = performance.now();
    let json: string;
    if (message.type === "load") json = call(pyodide, "load", message.bytes, message.name);
    else if (message.type === "run") json = call(pyodide, "run", message.code);
    else json = JSON.stringify({csv: call(pyodide, "export_csv")});
    post({type: "result", id: message.id, json, seconds: (performance.now() - started) / 1000});
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    // A Python error crossing into JavaScript carries the whole traceback; its last line says what went wrong,
    // after the exception's class name (ValueError: …), which means little to most people.
    const lastLine = (text.trim().split("\n").pop() ?? text).replace(/^[\w.]*(Error|Exception): /, "");
    post({type: "failed", id: message.id, message: lastLine});
  }
});

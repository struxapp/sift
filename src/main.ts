import "./style.css";
import {filterColumns, renderColumns} from "./columns";
import {$, el} from "./dom";
import {delimiterName, formatBytes, plural} from "./format";
import {fillIcons, icons} from "./icons";
import type {Overview, Stage} from "./protocol";
import {showNote, showResult} from "./result";
import {SAMPLES} from "./samples";
import {snippetsFor} from "./snippets";
import {initTheme} from "./theme";
import {type ClientStage, PythonClient, PythonUnavailableError, StoppedError} from "./worker-client";

const MAX_BYTES = 100 * 1024 * 1024;
const STAGE_TEXT: Record<ClientStage, string> = {
  runtime: "Starting Python…",
  packages: "Loading pandas…",
  ready: "Python ready",
  failed: "Python unavailable",
};
const STAGES: Stage[] = ["runtime", "packages", "ready"];

const unavailable = (message: string) => `${message} Check your connection, then reload the page to start Python again.`;

const python = new PythonClient({
  create: () => new Worker(new URL("./python.worker.ts", import.meta.url), {type: "module"}),
  indexURL: new URL("pyodide/", document.baseURI).href,
  onStage: showStage,
  onFailure: (message) => {
    if (!$("start").hidden) showStartError(unavailable(message), reloadButton());
    else showResult({kind: "error", message: unavailable(message), line: null, traceback: "", stdout: ""}, null, reloadButton());
  },
});

// ---------------------------------------------------------------- Python status

function showStage(stage: ClientStage): void {
  $("engine").dataset.state = stage;
  $("engine-text").textContent = STAGE_TEXT[stage];
  const current = stage === "failed" ? -1 : STAGES.indexOf(stage);
  for (const item of $("boot").querySelectorAll<HTMLElement>("li")) {
    const index = STAGES.indexOf(item.dataset.stage as Stage);
    item.dataset.state = stage === "ready" || index < current ? "done" : index === current ? "active" : "waiting";
  }
}

function reloadButton(): HTMLButtonElement {
  const button = el("button", "btn btn-small error-action", "Reload the page");
  button.type = "button";
  button.addEventListener("click", () => window.location.reload());
  return button;
}

// ---------------------------------------------------------------- Opening data

type Source = "file" | "paste";
let overview: Overview | null = null;

function showStartError(text: string, action?: HTMLElement): void {
  const box = $("start-error");
  box.replaceChildren(el("span", undefined, text));
  if (action) box.append(action);
  box.hidden = false;
  box.scrollIntoView({block: "nearest", behavior: "smooth"});
}

/** An error about pasted rows goes right under the box they were pasted in. */
function showPasteError(text: string): void {
  const box = $("paste-error");
  box.textContent = text;
  box.hidden = false;
  const paste = $<HTMLTextAreaElement>("paste");
  paste.setAttribute("aria-invalid", "true");
  paste.focus();
  box.scrollIntoView({block: "nearest", behavior: "smooth"});
}

function clearErrors(): void {
  $("start-error").hidden = true;
  $("paste-error").hidden = true;
  $("paste").removeAttribute("aria-invalid");
}

function setBusy(busy: boolean, text = ""): void {
  const drop = $("drop");
  drop.classList.toggle("busy", busy);
  drop.setAttribute("aria-busy", String(busy));
  drop.querySelector(".drop-busy")?.remove();
  if (busy) drop.append(el("p", "drop-busy", text));
}

async function openData(bytes: Uint8Array, name: string, source: Source = "file"): Promise<void> {
  clearErrors();
  const fail = (text: string) => (source === "paste" ? showPasteError(text) : showStartError(text));
  if (bytes.byteLength === 0) return fail(`${name} is empty.`);
  if (bytes.byteLength > MAX_BYTES) {
    return fail(`${name} is ${formatBytes(bytes.byteLength)}. Sift opens files up to 100 MB, since everything stays in this tab's memory.`);
  }
  setBusy(true, python.stage === "ready" ? `Reading ${name}…` : `${name} opens as soon as Python is ready…`);
  try {
    overview = await python.load(bytes, name);
    showWorkspace(overview);
  } catch (error) {
    if (error instanceof PythonUnavailableError) showStartError(unavailable(error.message), reloadButton());
    else fail(`Sift could not read ${name}: ${(error as Error).message}`);
  } finally {
    setBusy(false);
  }
}

async function openFile(file: File): Promise<void> {
  if (file.size > MAX_BYTES) {
    clearErrors();
    return showStartError(`${file.name} is ${formatBytes(file.size)}. Sift opens files up to 100 MB.`);
  }
  await openData(new Uint8Array(await file.arrayBuffer()), file.name);
}

/** Back to the start screen with the examples; the open file stays one click away. */
function showStart(): void {
  $("workspace").hidden = true;
  $("start").hidden = false;
  $("open-another").hidden = true;
  $<HTMLInputElement>("file").value = "";
  clearErrors();
  const resume = $("resume");
  resume.hidden = !overview;
  if (overview) $("resume-name").textContent = overview.name;
  $("start-title").focus();
}

// ---------------------------------------------------------------- Workspace

/** Shows the workspace as it was left: the query and result stay. */
function enterWorkspace(): void {
  $("start").hidden = true;
  $("workspace").hidden = false;
  $("open-another").hidden = false;
  $("file-name").focus();
}

function showWorkspace(data: Overview): void {
  $("file-name").textContent = data.name;
  const columns = plural(data.columns.length, "column");
  $("file-facts").textContent = [
    data.rows ? plural(data.rows, "row") : "No rows: only a header line found",
    columns,
    `${delimiterName(data.delimiter)} separated`,
    data.encoding === "utf-8" ? "UTF-8" : data.encoding === "cp1252" ? "Windows-1252" : data.encoding,
    `${formatBytes(data.memory)} in memory`,
  ].join(" · ");
  renderColumns(data.columns, data.rows, insertAtCursor);
  renderSnippets(data);
  $<HTMLInputElement>("column-filter").value = "";
  $<HTMLTextAreaElement>("query").value = "df";
  showResult({...data.preview, stdout: ""}, null);
  if (!data.rows) showNote(`Only a header line found: ${data.name} names ${columns} but has no rows under them.`);
  enterWorkspace();
}

function renderSnippets(data: Overview): void {
  const box = $("snippets");
  box.replaceChildren();
  for (const snippet of snippetsFor(data.columns, data.rows)) {
    const button = el("button", "chip", snippet.label);
    button.type = "button";
    button.title = snippet.code;
    button.addEventListener("click", () => {
      $<HTMLTextAreaElement>("query").value = snippet.code;
      void run();
    });
    box.append(button);
  }
}

function insertAtCursor(text: string): void {
  const query = $<HTMLTextAreaElement>("query");
  const {selectionStart, selectionEnd, value} = query;
  query.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
  query.focus();
  query.setSelectionRange(selectionStart + text.length, selectionStart + text.length);
}

// ---------------------------------------------------------------- Running queries

let running = false;
let stopTimer = 0;

async function run(): Promise<void> {
  const code = $<HTMLTextAreaElement>("query").value.trim();
  if (!code || running) return;
  running = true;
  $<HTMLButtonElement>("run").disabled = true;
  $("result-meta").textContent = python.stage === "ready" ? "Running…" : "Waiting for Python…";
  $("result-card").setAttribute("aria-busy", "true");
  stopTimer = window.setTimeout(() => ($("stop").hidden = false), 400);
  try {
    const {result, seconds} = await python.run(code);
    showResult(result, seconds);
  } catch (error) {
    if (error instanceof PythonUnavailableError) {
      showResult({kind: "error", message: unavailable(error.message), line: null, traceback: "", stdout: ""}, null, reloadButton());
    } else if (!(error instanceof StoppedError)) {
      showResult({kind: "error", message: (error as Error).message, line: null, traceback: "", stdout: ""}, null);
    }
  } finally {
    running = false;
    window.clearTimeout(stopTimer);
    $("stop").hidden = true;
    $<HTMLButtonElement>("run").disabled = false;
    $("result-card").removeAttribute("aria-busy");
  }
}

async function stop(): Promise<void> {
  $("stop").hidden = true;
  $("result-meta").textContent = "Stopped. Python is starting again and will reopen your file; variables you made are gone.";
  try {
    if (await python.restart()) $("result-meta").textContent = "Stopped. Your file is open again; variables you made are gone.";
  } catch (error) {
    if (!(error instanceof PythonUnavailableError)) {
      showResult({kind: "error", message: (error as Error).message, line: null, traceback: "", stdout: ""}, null);
    }
  }
}

async function downloadCsv(): Promise<void> {
  let csv: string;
  try {
    csv = await python.exportCsv();
  } catch (error) {
    $("result-meta").textContent = `The CSV could not be made: ${(error as Error).message}`;
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  link.download = `${(python.file?.name ?? "data").replace(/\.[^.]+$/, "")}-result.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------------------------------------------------------------- Page wiring

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

function wireDrop(): void {
  const overlay = $("drop-overlay");
  let depth = 0;
  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener("dragover", (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const file = event.dataTransfer?.files[0];
    if (file) void openFile(file);
  });
}

function wireStart(): void {
  for (const sample of SAMPLES) {
    const button = el("button", "sample");
    button.type = "button";
    button.innerHTML = icons.table;
    const words = el("span", "sample-words");
    words.append(el("span", "sample-name", sample.name), el("span", "sample-description", sample.description));
    button.append(words);
    button.addEventListener("click", () => void openData(new TextEncoder().encode(sample.csv()), sample.fileName));
    $("samples").append(button);
  }

  const input = $<HTMLInputElement>("file");
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void openFile(file);
  });

  const pasteToggle = $("paste-toggle");
  pasteToggle.addEventListener("click", () => {
    const panel = $("paste-panel");
    panel.hidden = !panel.hidden;
    pasteToggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) $("paste").focus();
  });
  $("paste").addEventListener("input", () => {
    $("paste-error").hidden = true;
    $("paste").removeAttribute("aria-invalid");
  });
  $("paste-open").addEventListener("click", () => {
    const text = $<HTMLTextAreaElement>("paste").value;
    if (!text.trim()) return showPasteError("Paste some rows first, with a header line on top.");
    void openData(new TextEncoder().encode(text), "Pasted data", "paste");
  });

  $("resume").addEventListener("click", enterWorkspace);
}

function wireWorkspace(): void {
  const query = $<HTMLTextAreaElement>("query");
  query.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void run();
    }
  });
  $("run").addEventListener("click", () => void run());
  $("stop").addEventListener("click", () => void stop());
  $("download").addEventListener("click", () => void downloadCsv());
  const filter = $<HTMLInputElement>("column-filter");
  filter.addEventListener("input", () => filterColumns(filter.value));

  const platform = (navigator as Navigator & {userAgentData?: {platform: string}}).userAgentData?.platform ?? navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(platform)) $("key-hint").innerHTML = "<kbd>⌘</kbd> + <kbd>Enter</kbd> runs · ";
}

function wire(): void {
  fillIcons();
  const themeButton = $<HTMLButtonElement>("theme");
  const toggleTheme = initTheme((theme) => {
    themeButton.innerHTML = theme === "dark" ? icons.sun : icons.moon;
    themeButton.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  });
  themeButton.addEventListener("click", toggleTheme);
  $("home").addEventListener("click", (event) => {
    event.preventDefault();
    showStart();
  });
  $("open-another").addEventListener("click", showStart);
  wireStart();
  wireWorkspace();
  wireDrop();
}

wire();
python.start();

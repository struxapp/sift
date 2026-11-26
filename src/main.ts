import "./style.css";
import {delimiterName, formatBytes, formatCell, formatDate, formatNumber, plural, pythonString} from "./format";
import {fillIcons, icons, logo} from "./icons";
import type {ColumnSummary, FromWorker, Overview, RunResult, Stage, TableResult, ToWorker} from "./protocol";
import {SAMPLES} from "./samples";
import {snippetsFor} from "./snippets";
import {initTheme} from "./theme";

const MAX_BYTES = 100 * 1024 * 1024;
const STAGE_TEXT: Record<Stage, string> = {
  runtime: "Starting Python…",
  packages: "Loading pandas…",
  ready: "Python ready",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

// ---------------------------------------------------------------- Python worker

type Pending = {resolve: (value: {json: string; seconds: number}) => void; reject: (error: Error) => void};
let worker: Worker;
let stage: Stage | "failed" = "runtime";
let nextId = 1;
const pending = new Map<number, Pending>();

function startWorker(): void {
  worker = new Worker(new URL("./python.worker.ts", import.meta.url), {type: "module"});
  worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.type === "stage") return setStage(message.stage);
    if (message.type === "fatal") {
      setStage("failed");
      showStartError(`Python could not start (${message.message}). Check your connection and reload the page.`);
      for (const waiting of pending.values()) waiting.reject(new Error("Python could not start."));
      pending.clear();
      return;
    }
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.type === "result") waiting.resolve({json: message.json, seconds: message.seconds});
    else waiting.reject(new Error(message.message));
  });
  worker.addEventListener("error", () => {
    setStage("failed");
    showStartError("Python stopped unexpectedly. Reload the page to start it again.");
  });
  setStage("runtime");
  post({type: "init", indexURL: new URL("pyodide/", document.baseURI).href});
}

function post(message: ToWorker, transfer: Transferable[] = []): void {
  worker.postMessage(message, transfer);
}

type Request = ToWorker extends infer M ? (M extends {id: number} ? Omit<M, "id"> : never) : never;

function request(message: Request, transfer: Transferable[] = []) {
  const id = nextId++;
  return new Promise<{json: string; seconds: number}>((resolve, reject) => {
    pending.set(id, {resolve, reject});
    post({...message, id} as ToWorker, transfer);
  });
}

function setStage(next: Stage | "failed"): void {
  stage = next;
  const engine = $("engine");
  engine.dataset.state = next;
  $("engine-text").textContent = next === "failed" ? "Python unavailable" : STAGE_TEXT[next];
  const order: Stage[] = ["runtime", "packages", "ready"];
  for (const item of $("boot").querySelectorAll<HTMLElement>("li")) {
    const index = order.indexOf(item.dataset.stage as Stage);
    const current = next === "failed" ? -1 : order.indexOf(next);
    item.dataset.state = next === "ready" || index < current ? "done" : index === current ? "active" : "waiting";
  }
}

function showStartError(text: string): void {
  const box = $("start-error");
  box.textContent = text;
  box.hidden = false;
  setBusy(false);
}

// ---------------------------------------------------------------- Opening data

let opened: {bytes: Uint8Array; name: string} | null = null;
let overview: Overview | null = null;

function setBusy(busy: boolean, text = ""): void {
  const drop = $("drop");
  drop.classList.toggle("busy", busy);
  drop.setAttribute("aria-busy", String(busy));
  const title = drop.querySelector<HTMLElement>(".drop-busy");
  if (title) title.remove();
  if (busy) drop.append(el("p", "drop-busy", text));
}

async function openData(bytes: Uint8Array, name: string): Promise<void> {
  $("start-error").hidden = true;
  if (bytes.byteLength === 0) return showStartError(`${name} is empty.`);
  if (bytes.byteLength > MAX_BYTES) {
    return showStartError(`${name} is ${formatBytes(bytes.byteLength)}. Sift opens files up to 100 MB, since everything stays in this tab's memory.`);
  }
  setBusy(true, stage === "ready" ? `Reading ${name}…` : `${name} opens as soon as Python is ready…`);
  opened = {bytes, name};
  try {
    const {json} = await request({type: "load", bytes: bytes.slice(), name});
    overview = JSON.parse(json) as Overview;
    showWorkspace(overview);
  } catch (error) {
    showStartError(`Sift could not read ${name}: ${(error as Error).message}`);
  } finally {
    setBusy(false);
  }
}

async function openFile(file: File): Promise<void> {
  if (file.size > MAX_BYTES) return showStartError(`${file.name} is ${formatBytes(file.size)}. Sift opens files up to 100 MB.`);
  await openData(new Uint8Array(await file.arrayBuffer()), file.name);
}

function showStart(): void {
  $("workspace").hidden = true;
  $("start").hidden = false;
  $("open-another").hidden = true;
  ($("file") as HTMLInputElement).value = "";
  $("start-title").setAttribute("tabindex", "-1");
  $("start-title").focus();
}

// ---------------------------------------------------------------- Workspace

function showWorkspace(data: Overview): void {
  $("start").hidden = true;
  $("workspace").hidden = false;
  $("open-another").hidden = false;
  $("file-name").textContent = data.name;
  $("file-facts").textContent = [
    plural(data.rows, "row"),
    plural(data.columns.length, "column"),
    `${delimiterName(data.delimiter)} separated`,
    data.encoding === "utf-8" ? "UTF-8" : data.encoding === "cp1252" ? "Windows-1252" : data.encoding,
    `${formatBytes(data.memory)} in memory`,
  ].join(" · ");
  renderColumns(data.columns, data.rows);
  renderSnippets(data);
  const query = $<HTMLTextAreaElement>("query");
  query.value = "df";
  showResult({...data.preview, stdout: ""}, null);
  $("file-name").setAttribute("tabindex", "-1");
  $("file-name").focus();
}

function histogram(values: number[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${values.length * 10} 40`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "histogram");
  svg.setAttribute("aria-hidden", "true");
  const max = Math.max(...values, 1);
  values.forEach((value, index) => {
    if (!value) return;
    const height = Math.max(2, (value / max) * 40);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(index * 10 + 1));
    rect.setAttribute("y", String(40 - height));
    rect.setAttribute("width", "8");
    rect.setAttribute("height", String(height));
    rect.setAttribute("rx", "1.5");
    svg.append(rect);
  });
  return svg;
}

const KIND_LABEL: Record<string, string> = {integer: "whole number", number: "number", date: "date", boolean: "yes / no", text: "text"};

function stat(list: HTMLElement, label: string, value: string): void {
  const wrap = el("div");
  wrap.append(el("dt", undefined, label), el("dd", "mono", value));
  list.append(wrap);
}

function renderColumns(columns: ColumnSummary[], rows: number): void {
  const list = $("columns");
  list.replaceChildren();
  for (const column of columns) {
    const item = el("li", "column");
    item.dataset.name = column.name.toLowerCase();
    const head = el("div", "column-head");
    const title = el("h3", "column-name mono", column.name);
    title.title = column.name;
    const badge = el("span", `kind kind-${column.kind}`, KIND_LABEL[column.kind] ?? column.kind);
    const insert = el("button", "btn btn-icon btn-ghost btn-small");
    insert.type = "button";
    insert.innerHTML = icons.insert;
    insert.setAttribute("aria-label", `Insert df[${pythonString(column.name)}] into the query`);
    insert.title = "Insert into the query";
    insert.addEventListener("click", () => insertAtCursor(`df[${pythonString(column.name)}]`));
    head.append(title, badge, insert);
    item.append(head);

    const facts = [`${formatNumber(column.unique)} distinct`];
    if (column.missing) facts.unshift(`${formatNumber(column.missing)} missing (${formatNumber(Math.round((column.missing / Math.max(rows, 1)) * 1000) / 10)}%)`);
    else facts.unshift("none missing");
    item.append(el("p", `column-facts${column.missing ? " has-missing" : ""}`, facts.join(" · ")));

    if (column.stats) {
      const stats = el("dl", "stats");
      stat(stats, "min", formatNumber(column.stats.min));
      stat(stats, "median", formatNumber(column.stats.median));
      stat(stats, "mean", formatNumber(column.stats.mean));
      stat(stats, "max", formatNumber(column.stats.max));
      item.append(stats);
    }
    if (column.range) {
      const stats = el("dl", "stats stats-two");
      stat(stats, "from", formatDate(column.range.min));
      stat(stats, "to", formatDate(column.range.max));
      item.append(stats);
    }
    if (column.histogram && column.histogram.counts.length > 1) item.append(histogram(column.histogram.counts));
    if (column.top?.length) {
      const top = el("ul", "top-values");
      top.setAttribute("aria-label", `Most common values of ${column.name}`);
      const present = Math.max(rows - column.missing, 1);
      for (const entry of column.top) {
        const row = el("li");
        row.style.setProperty("--share", `${Math.max(1, (entry.count / present) * 100)}%`);
        row.append(el("span", "top-value", entry.value || "(empty)"), el("span", "top-count mono", formatNumber(entry.count)));
        top.append(row);
      }
      item.append(top);
    }
    list.append(item);
  }
}

function renderSnippets(data: Overview): void {
  const box = $("snippets");
  box.replaceChildren();
  for (const snippet of snippetsFor(data.columns, data.rows)) {
    const button = el("button", "chip", snippet.label);
    button.type = "button";
    button.title = snippet.code;
    button.addEventListener("click", () => {
      const query = $<HTMLTextAreaElement>("query");
      query.value = snippet.code;
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
  const query = $<HTMLTextAreaElement>("query");
  const code = query.value.trim();
  if (!code || running) return;
  running = true;
  $<HTMLButtonElement>("run").disabled = true;
  $("result-meta").textContent = stage === "ready" ? "Running…" : "Waiting for Python…";
  $("result-card").setAttribute("aria-busy", "true");
  stopTimer = window.setTimeout(() => ($("stop").hidden = false), 400);
  try {
    const {json, seconds} = await request({type: "run", code});
    showResult(JSON.parse(json) as RunResult, seconds);
  } catch (error) {
    if (!(error instanceof StoppedError)) showResult({kind: "error", message: (error as Error).message, line: null, traceback: "", stdout: ""}, null);
  } finally {
    running = false;
    window.clearTimeout(stopTimer);
    $("stop").hidden = true;
    $<HTMLButtonElement>("run").disabled = false;
    $("result-card").removeAttribute("aria-busy");
  }
}

class StoppedError extends Error {}

/** Ends the worker (the only way to interrupt Python without SharedArrayBuffer), starts a new one and opens the file again. */
async function stop(): Promise<void> {
  worker.terminate();
  for (const waiting of pending.values()) waiting.reject(new StoppedError("Stopped"));
  pending.clear();
  startWorker();
  $("result-meta").textContent = "Stopped. Python is starting again and will reopen your file; variables you made are gone.";
  $("stop").hidden = true;
  if (opened) {
    try {
      await request({type: "load", bytes: opened.bytes.slice(), name: opened.name});
      $("result-meta").textContent = "Stopped. Your file is open again; variables you made are gone.";
    } catch (error) {
      showResult({kind: "error", message: (error as Error).message, line: null, traceback: "", stdout: ""}, null);
    }
  }
}

function showResult(result: RunResult, seconds: number | null): void {
  const stdout = $("stdout");
  const error = $("error");
  const text = $("text-result");
  const wrap = $("table-wrap");
  const empty = $("empty");
  const download = $("download");
  for (const part of [stdout, error, text, wrap, empty, download]) part.hidden = true;
  const time = seconds === null ? "" : ` · ${seconds < 1 ? `${Math.max(1, Math.round(seconds * 1000))} ms` : `${seconds.toFixed(1)} s`}`;

  if ("stdout" in result && result.stdout) {
    stdout.textContent = result.stdout;
    stdout.hidden = false;
  }
  if (result.kind === "table") {
    renderTable(result);
    wrap.hidden = false;
    download.hidden = false;
    const shown = result.rows.length;
    const rows = shown < result.totalRows ? `First ${formatNumber(shown)} of ${plural(result.totalRows, "row")}` : plural(result.totalRows, "row");
    $("result-meta").textContent = `${rows} · ${plural(result.totalColumns, "column")}${time}`;
  } else if (result.kind === "text") {
    text.textContent = result.text;
    text.hidden = false;
    $("result-meta").textContent = `Value${time}`;
  } else if (result.kind === "none") {
    if (!result.stdout) {
      empty.textContent = "Done. The code ran without a value to show; end with an expression, such as df, to see a table.";
      empty.hidden = false;
    }
    $("result-meta").textContent = `Done${time}`;
  } else {
    error.replaceChildren();
    error.append(el("p", "error-title", result.line ? `Line ${result.line}: ${result.message}` : result.message));
    if (result.traceback) {
      const details = el("details");
      details.append(el("summary", undefined, "Python traceback"), el("pre", "mono", result.traceback));
      error.append(details);
    }
    error.hidden = false;
    $("result-meta").textContent = `Error${time}`;
  }
}

function renderTable(result: TableResult): void {
  const table = $("table");
  table.replaceChildren();
  const caption = el("caption", "sr-only", `Result: ${plural(result.totalRows, "row")}, ${plural(result.totalColumns, "column")}`);
  const head = el("thead");
  const headRow = el("tr");
  if (result.index) {
    const th = el("th", "index-col", result.indexName || "");
    th.scope = "col";
    if (!result.indexName) th.append(el("span", "sr-only", "Row label"));
    headRow.append(th);
  }
  result.columns.forEach((name, i) => {
    const th = el("th", isNumeric(shownKind(result, i)) ? "num" : undefined, name);
    th.scope = "col";
    headRow.append(th);
  });
  head.append(headRow);
  const body = el("tbody");
  result.rows.forEach((row, r) => {
    const tr = el("tr");
    if (result.index) {
      const th = el("th", "index-col", formatDate(result.index[r]));
      th.scope = "row";
      tr.append(th);
    }
    row.forEach((value, i) => {
      const kind = shownKind(result, i);
      const td = el("td", isNumeric(kind) ? "num" : undefined, formatCell(value, kind));
      if (value === null) td.classList.add("missing");
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(caption, head, body);
  $("table-wrap").scrollTo({top: 0, left: 0});
}

const isNumeric = (kind: string) => kind === "integer" || kind === "number";

/** ID-like whole numbers (order_id, zip, year) read better without thousands separators, left-aligned like text. */
function shownKind(result: TableResult, column: number): string {
  const kind = result.kinds[column];
  return kind === "integer" && /(^|[_\s-])(id|code|zip|year|postcode)$/i.test(result.columns[column] ?? "") ? "text" : kind;
}

async function downloadCsv(): Promise<void> {
  const {json} = await request({type: "export"});
  const {csv} = JSON.parse(json) as {csv: string};
  const blob = new Blob([csv], {type: "text/csv;charset=utf-8"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const base = (opened?.name ?? "data").replace(/\.[^.]+$/, "");
  link.download = `${base}-result.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------------------------------------------------------------- Page wiring

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

function wire(): void {
  document.querySelector(".brand-mark")!.innerHTML = logo;
  fillIcons();

  const themeButton = $<HTMLButtonElement>("theme");
  const toggleTheme = initTheme((theme) => {
    themeButton.innerHTML = theme === "dark" ? icons.sun : icons.moon;
    themeButton.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  });
  themeButton.addEventListener("click", toggleTheme);

  const samples = $("samples");
  for (const sample of SAMPLES) {
    const button = el("button", "sample");
    button.type = "button";
    button.innerHTML = icons.table;
    const words = el("span", "sample-words");
    words.append(el("span", "sample-name", sample.name), el("span", "sample-description", sample.description));
    button.append(words);
    button.addEventListener("click", () => void openData(new TextEncoder().encode(sample.csv()), sample.fileName));
    samples.append(button);
  }

  const input = $<HTMLInputElement>("file");
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void openFile(file);
  });
  $("open-another").addEventListener("click", showStart);

  const pasteToggle = $("paste-toggle");
  pasteToggle.addEventListener("click", () => {
    const panel = $("paste-panel");
    panel.hidden = !panel.hidden;
    pasteToggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) $("paste").focus();
  });
  $("paste-open").addEventListener("click", () => {
    const text = $<HTMLTextAreaElement>("paste").value;
    if (!text.trim()) return showStartError("Paste some rows first, with a header line on top.");
    void openData(new TextEncoder().encode(text), "Pasted data");
  });

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
  filter.addEventListener("input", () => {
    const needle = filter.value.trim().toLowerCase();
    for (const item of $("columns").querySelectorAll<HTMLElement>(".column")) item.hidden = !!needle && !item.dataset.name!.includes(needle);
  });

  if (/Mac|iPhone|iPad/.test(navigator.platform)) $("query-hint").innerHTML = "<kbd>⌘</kbd> + <kbd>Enter</kbd> runs · <code>df</code> is your file";
}

wire();
startWorker();

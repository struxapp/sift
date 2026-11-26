// The Result card: a table, a value, print output or an error, with a line that says what is shown.
import {$, el} from "./dom";
import {columnNumberFormat, formatCell, formatDate, formatNumber, plural} from "./format";
import type {RunResult, TableResult} from "./protocol";

const isNumeric = (kind: string) => kind === "integer" || kind === "number";

/** ID-like whole numbers (order_id, zip, year) read better without thousands separators, left-aligned like text. */
function shownKind(result: TableResult, column: number): string {
  const kind = result.kinds[column];
  return kind === "integer" && /(^|[_\s-])(id|code|zip|year|postcode)$/i.test(result.columns[column] ?? "") ? "text" : kind;
}

function renderTable(result: TableResult): void {
  const table = $("table");
  const caption = el("caption", "sr-only", `Result: ${plural(result.totalRows, "row")}, ${plural(result.totalColumns, "column")}`);
  const kinds = result.columns.map((_, i) => shownKind(result, i));
  const numberFormats = kinds.map((kind, i) => (isNumeric(kind) ? columnNumberFormat(result.rows.map((row) => row[i])) : formatNumber));

  const headRow = el("tr");
  if (result.index) {
    const th = el("th", "index-col", result.indexName || "");
    th.scope = "col";
    if (!result.indexName) th.append(el("span", "sr-only", "Row label"));
    headRow.append(th);
  }
  result.columns.forEach((name, i) => {
    const th = el("th", isNumeric(kinds[i]) ? "num" : undefined, name);
    th.scope = "col";
    headRow.append(th);
  });
  const head = el("thead");
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
      const td = el("td", isNumeric(kinds[i]) ? "num" : undefined, formatCell(value, kinds[i], numberFormats[i]));
      if (value === null) td.classList.add("missing");
      tr.append(td);
    });
    body.append(tr);
  });
  table.replaceChildren(caption, head, body);
  $("table-wrap").scrollTo({top: 0, left: 0});
}

/** Shows a result; `action` (such as a Reload button) goes under an error message. */
export function showResult(result: RunResult, seconds: number | null, action?: HTMLElement): void {
  const stdout = $("stdout");
  const error = $("error");
  const text = $("text-result");
  const wrap = $("table-wrap");
  const empty = $("empty");
  const meta = $("result-meta");
  for (const part of [stdout, error, text, wrap, empty, $("download")]) part.hidden = true;
  const time = seconds === null ? "" : ` · ${seconds < 1 ? `${Math.max(1, Math.round(seconds * 1000))} ms` : `${seconds.toFixed(1)} s`}`;

  if (result.stdout) {
    stdout.textContent = result.stdout;
    stdout.hidden = false;
  }
  if (result.kind === "table") {
    renderTable(result);
    wrap.hidden = false;
    $("download").hidden = false;
    const shown = result.rows.length;
    const rows = shown < result.totalRows ? `First ${formatNumber(shown)} of ${plural(result.totalRows, "row")}` : plural(result.totalRows, "row");
    meta.textContent = `${rows} · ${plural(result.totalColumns, "column")}${time}`;
  } else if (result.kind === "text") {
    text.textContent = result.text;
    text.hidden = false;
    meta.textContent = `Value${time}`;
  } else if (result.kind === "none") {
    if (!result.stdout) {
      empty.textContent = "Done. The code ran without a value to show; end with an expression, such as df, to see a table.";
      empty.hidden = false;
    }
    meta.textContent = `Done${time}`;
  } else {
    error.replaceChildren(el("p", "error-title", result.line ? `Line ${result.line}: ${result.message}` : result.message));
    if (result.traceback) {
      const details = el("details");
      details.append(el("summary", undefined, "Python traceback"), el("pre", "mono", result.traceback));
      error.append(details);
    }
    if (action) error.append(action);
    error.hidden = false;
    meta.textContent = `Error${time}`;
  }
}

/** A short note in place of the table, such as for a file with only a header line. */
export function showNote(note: string): void {
  const empty = $("empty");
  empty.textContent = note;
  empty.hidden = false;
}

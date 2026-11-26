// The Columns pane: one card per column with its type, missing values, statistics, histogram or most common values.
import {$, el} from "./dom";
import {formatDate, formatNumber, pythonString} from "./format";
import {icons} from "./icons";
import type {ColumnSummary} from "./protocol";

const KIND_LABEL: Record<string, string> = {
  integer: "whole number",
  number: "number",
  date: "date",
  time: "time",
  boolean: "yes / no",
  text: "text",
};

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

function stat(list: HTMLElement, label: string, value: string): void {
  const wrap = el("div");
  wrap.append(el("dt", undefined, label), el("dd", "mono", value));
  list.append(wrap);
}

function card(column: ColumnSummary, rows: number, onInsert: (code: string) => void): HTMLLIElement {
  const item = el("li", "column");
  item.dataset.name = column.name.toLowerCase();
  const head = el("div", "column-head");
  const title = el("h3", "column-name mono", column.name);
  title.title = column.name;
  const badge = column.identifier
    ? el("span", "kind kind-id", "ID")
    : el("span", `kind kind-${column.kind}`, KIND_LABEL[column.kind] ?? column.kind);
  if (column.identifier) badge.title = "Every value is different, so it names a row: no average is shown";
  const code = `df[${pythonString(column.name)}]`;
  const insert = el("button", "btn btn-icon btn-ghost btn-small");
  insert.type = "button";
  insert.innerHTML = icons.insert;
  insert.setAttribute("aria-label", `Insert ${code} into the query`);
  insert.title = "Insert into the query";
  insert.addEventListener("click", () => onInsert(code));
  head.append(title, badge, insert);
  item.append(head);

  const share = formatNumber(Math.round((column.missing / Math.max(rows, 1)) * 1000) / 10);
  const facts = [column.missing ? `${formatNumber(column.missing)} missing (${share}%)` : "none missing", `${formatNumber(column.unique)} distinct`];
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
    const [from, to] = column.identifier ? ["lowest", "highest"] : ["from", "to"];
    stat(stats, from, formatDate(column.range.min));
    stat(stats, to, formatDate(column.range.max));
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
  return item;
}

export function renderColumns(columns: readonly ColumnSummary[], rows: number, onInsert: (code: string) => void): void {
  $("columns").replaceChildren(...columns.map((column) => card(column, rows, onInsert)));
}

/** Shows only the columns whose name contains the text typed in "Find a column". */
export function filterColumns(text: string): void {
  const needle = text.trim().toLowerCase();
  for (const item of $("columns").querySelectorAll<HTMLElement>(".column")) {
    item.hidden = !!needle && !(item.dataset.name ?? "").includes(needle);
  }
}

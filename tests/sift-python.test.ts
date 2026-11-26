// Runs src/sift.py in the real Pyodide (from node_modules) with the vendored wheels, the same code the page runs.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {beforeAll, describe, expect, it} from "vitest";
import {loadPyodide, type PyodideAPI} from "pyodide";
import type {ColumnSummary, Overview, RunResult, TableResult} from "../src/protocol";
import {cafeSalesCsv, weatherCsv} from "../src/samples";

const root = fileURLToPath(new URL("..", import.meta.url));
let pyodide: PyodideAPI;

function call(name: string, ...args: unknown[]): string {
  const fn = pyodide.globals.get(name);
  try {
    return fn(...args) as string;
  } finally {
    fn.destroy();
  }
}

const bytes = (text: string) => new TextEncoder().encode(text);
const load = (text: string | Uint8Array, name = "test.csv") =>
  JSON.parse(call("load", typeof text === "string" ? bytes(text) : text, name)) as Overview;
const run = (code: string) => JSON.parse(call("run", code)) as RunResult;
const runTable = (code: string) => {
  const result = run(code);
  expect(result.kind).toBe("table");
  return result as TableResult;
};
const column = (overview: Overview, name: string) => overview.columns.find((c) => c.name === name) as ColumnSummary;

beforeAll(async () => {
  pyodide = await loadPyodide({
    indexURL: `${root}node_modules/pyodide/`,
    packageBaseUrl: `${root}vendor/pyodide-packages/`,
  });
  await pyodide.loadPackage(["pandas"], {messageCallback: () => {}});
  pyodide.runPython(readFileSync(`${root}src/sift.py`, "utf8"));
}, 120_000);

describe("load", () => {
  it("describes the café sample", () => {
    const overview = load(cafeSalesCsv(), "cafe.csv");
    expect(overview.rows).toBeGreaterThan(5000);
    expect(overview.delimiter).toBe(",");
    const kinds = Object.fromEntries(overview.columns.map((c) => [c.name, c.kind]));
    expect(kinds).toMatchObject({order_id: "integer", date: "date", time: "time", shop: "text", total: "number", quantity: "integer"});
    expect(column(overview, "shop").top?.map((t) => t.value).toSorted()).toEqual(["Harbour", "Old Town", "Station"]);
    const total = column(overview, "total");
    expect(total.histogram?.counts.reduce((a, b) => a + b, 0)).toBe(overview.rows);
    expect(overview.preview.rows).toHaveLength(200);
    expect(overview.preview.index).toBeNull();
  });

  it("treats unique whole-number id columns as identifiers, without mean or median", () => {
    const overview = load(cafeSalesCsv(), "cafe.csv");
    const orderId = column(overview, "order_id");
    expect(orderId.identifier).toBe(true);
    expect(orderId.stats).toBeUndefined();
    expect(orderId.range).toEqual({min: "10000", max: String(10_000 + overview.rows - 1)});
    // A quantity repeats its values, so it keeps its statistics.
    expect(column(overview, "quantity").stats?.mean).toBeGreaterThan(1);
  });

  it("detects clock times and gives their range", () => {
    const overview = load("at,n\n08:05,1\n9:30,2\n17:45:10,3\n");
    const at = column(overview, "at");
    expect(at.kind).toBe("time");
    expect(at.range).toEqual({min: "08:05:00", max: "17:45:10"});
    expect(at.histogram?.counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(load("at\n9:30\n17:45\n").columns[0].range).toEqual({min: "09:30", max: "17:45"});
  });

  it("counts the weather sample's gaps and reads semicolons, a BOM and Windows-1252", () => {
    const weather = load(weatherCsv(), "weather.csv");
    expect(column(weather, "temp_max_c").missing).toBeGreaterThan(0);
    const latin = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("name;price\nCrème;3,5\nThé;2\n")]);
    const semi = load(latin, "semi.csv");
    expect(semi.delimiter).toBe(";");
    expect(semi.columns.map((c) => c.name)).toEqual(["name", "price"]);
    const cp1252 = load(new Uint8Array([...bytes("city,n\nK"), 0xf6, ...bytes("ln,1\n")]), "cp.csv");
    expect(cp1252.encoding).toBe("cp1252");
    expect(cp1252.preview.rows[0][0]).toBe("Köln");
  });

  it("explains a file with no columns and opens a header-only file with no rows", () => {
    expect(() => load("\n\n")).toThrow(/no columns/);
    const header = load("name,amount\n");
    expect(header.rows).toBe(0);
    expect(header.columns.map((c) => c.name)).toEqual(["name", "amount"]);
  });

  it("names blank headers and makes repeated headers unique", () => {
    const overview = load("name,,name, name ,amount\na,1,b,c,2\n");
    expect(overview.columns.map((c) => c.name)).toEqual(["name", "column_2", "name_2", "name_3", "amount"]);
  });

  it("describes an all-empty column as missing everywhere", () => {
    const overview = load("a,b\n1,\n2,\n3,\n");
    const b = column(overview, "b");
    expect(b.missing).toBe(3);
    expect(b.unique).toBe(0);
    expect(b.stats).toBeUndefined();
    expect(b.histogram ?? null).toBeNull();
  });

  it("reads a column as dates when at least 95% of its values are ISO dates", () => {
    const dates = Array.from({length: 19}, (_, i) => `2025-01-${String(i + 1).padStart(2, "0")}`);
    const mostly = load(["day", ...dates, "unknown"].join("\n"));
    expect(column(mostly, "day")).toMatchObject({kind: "date", missing: 1});
    const fewer = load(["day", ...dates.slice(0, 18), "unknown", "later"].join("\n"));
    expect(column(fewer, "day").kind).toBe("text");
  });
});

describe("run", () => {
  beforeAll(() => {
    load(cafeSalesCsv(), "cafe.csv");
  });

  it("returns a grouped table with its index", () => {
    const result = runTable('df.groupby("shop")["total"].sum().round(2)');
    expect(result.index).toEqual(["Harbour", "Old Town", "Station"]);
    expect(result.indexName).toBe("shop");
    expect(result.columns).toEqual(["total"]);
  });

  it("joins the levels of a two-column group", () => {
    const result = runTable('df.groupby(["shop", "payment"])["total"].sum()');
    expect(result.index?.[0]).toBe("Harbour / Card");
    expect(result.indexName).toBe("shop / payment");
  });

  it("keeps variables between runs and captures print", () => {
    expect(run("big = df[df.quantity >= 3]\nprint(len(big) > 0)")).toMatchObject({stdout: "True\n"});
    expect(run("int(big.quantity.min())")).toMatchObject({kind: "text", text: "3"});
    expect(run("x = 1").kind).toBe("none");
  });

  it("keeps the end of very long print output and says it was cut", () => {
    const stdout = run('for i in range(5000):\n    print(f"line {i:05d}")').stdout ?? "";
    expect(stdout.length).toBeLessThanOrEqual(20_100);
    expect(stdout.startsWith("… earlier output cut")).toBe(true);
    expect(stdout.endsWith("line 04999\n")).toBe(true);
  });

  it("shows NumPy arrays and pandas indexes as tables, other values as text", () => {
    const unique = runTable('df["shop"].unique()');
    expect(unique.columns).toEqual(["value"]);
    expect(unique.rows.map((row) => row[0]).toSorted()).toEqual(["Harbour", "Old Town", "Station"]);
    const index = runTable("df.columns");
    expect(index.columns).toEqual(["value"]);
    expect(index.rows[0]).toEqual(["order_id"]);
    expect(runTable('df["quantity"].unique()').rows.map((row) => row[0]).toSorted()).toEqual([1, 2, 3]);
    expect(run("np.array(5)")).toMatchObject({kind: "text", text: "array(5)"});
  });

  it("explains errors with the line in the person's code", () => {
    const result = run("a = 1\ndf['nope']");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("KeyError");
    expect(result.line).toBe(2);
    expect(run("df[")).toMatchObject({kind: "error", message: expect.stringContaining("SyntaxError")});
  });

  it("exports the whole last table, not only the rows shown", () => {
    run("df[['order_id', 'total']]");
    const csv = call("export_csv");
    expect(csv.trim().split("\n").length - 1).toBeGreaterThan(5000);
    expect(csv.startsWith("order_id,total\n")).toBe(true);
  });

  it("exports a meaningful index as the first column", () => {
    run('df.groupby("shop")["total"].sum()');
    const lines = call("export_csv").trim().split("\n");
    expect(lines[0]).toBe("shop,total");
    expect(lines).toHaveLength(4);
    expect(lines[1].startsWith("Harbour,")).toBe(true);
  });
});

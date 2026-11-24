// Runs src/sift.py in the real Pyodide (from node_modules) with the vendored wheels, the same code the page runs.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {beforeAll, describe, expect, it} from "vitest";
import {loadPyodide, type PyodideAPI} from "pyodide";
import {cafeSalesCsv, weatherCsv} from "../src/samples";

const root = fileURLToPath(new URL("..", import.meta.url));
let pyodide: PyodideAPI;

async function call(name: string, ...args: unknown[]): Promise<any> {
  const fn = pyodide.globals.get(name);
  try {
    return JSON.parse(fn(...args));
  } finally {
    fn.destroy();
  }
}

const bytes = (text: string) => new TextEncoder().encode(text);

beforeAll(async () => {
  pyodide = await loadPyodide({
    indexURL: `${root}node_modules/pyodide/`,
    packageBaseUrl: `${root}vendor/pyodide-packages/`,
  });
  await pyodide.loadPackage(["pandas"], {messageCallback: () => {}});
  pyodide.runPython(readFileSync(`${root}src/sift.py`, "utf8"));
}, 120_000);

describe("load", () => {
  it("describes the café sample", async () => {
    const overview = await call("load", bytes(cafeSalesCsv()), "cafe.csv");
    expect(overview.rows).toBeGreaterThan(5000);
    expect(overview.delimiter).toBe(",");
    const kinds = Object.fromEntries(overview.columns.map((c: any) => [c.name, c.kind]));
    expect(kinds).toMatchObject({order_id: "integer", date: "date", shop: "text", total: "number", quantity: "integer"});
    const shop = overview.columns.find((c: any) => c.name === "shop");
    expect(shop.top.map((t: any) => t.value).sort()).toEqual(["Harbour", "Old Town", "Station"]);
    const total = overview.columns.find((c: any) => c.name === "total");
    expect(total.histogram.counts.reduce((a: number, b: number) => a + b, 0)).toBe(overview.rows);
    expect(overview.preview.rows).toHaveLength(200);
    expect(overview.preview.index).toBeNull();
  });

  it("counts the weather sample's gaps and reads semicolons, a BOM and Windows-1252", async () => {
    const weather = await call("load", bytes(weatherCsv()), "weather.csv");
    const temp = weather.columns.find((c: any) => c.name === "temp_max_c");
    expect(temp.missing).toBeGreaterThan(0);
    const latin = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("name;price\nCrème;3,5\nThé;2\n")]);
    const semi = await call("load", latin, "semi.csv");
    expect(semi.delimiter).toBe(";");
    expect(semi.columns.map((c: any) => c.name)).toEqual(["name", "price"]);
    const cp1252 = await call("load", new Uint8Array([...bytes("city,n\nK"), 0xf6, ...bytes("ln,1\n")]), "cp.csv");
    expect(cp1252.encoding).toBe("cp1252");
    expect(cp1252.preview.rows[0][0]).toBe("Köln");
  });
});

describe("run", () => {
  beforeAll(async () => {
    await call("load", bytes(cafeSalesCsv()), "cafe.csv");
  });

  it("returns a grouped table with its index", async () => {
    const result = await call("run", 'df.groupby("shop")["total"].sum().round(2)');
    expect(result.kind).toBe("table");
    expect(result.index).toEqual(["Harbour", "Old Town", "Station"]);
    expect(result.indexName).toBe("shop");
    expect(result.columns).toEqual(["total"]);
  });

  it("keeps variables between runs and captures print", async () => {
    expect((await call("run", "big = df[df.quantity >= 3]\nprint(len(big) > 0)")).stdout).toBe("True\n");
    const scalar = await call("run", "int(big.quantity.min())");
    expect(scalar).toMatchObject({kind: "text", text: "3"});
    expect((await call("run", "x = 1")).kind).toBe("none");
  });

  it("explains errors with the line in the person's code", async () => {
    const result = await call("run", "a = 1\ndf['nope']");
    expect(result.kind).toBe("error");
    expect(result.message).toContain("KeyError");
    expect(result.line).toBe(2);
    const syntax = await call("run", "df[");
    expect(syntax.kind).toBe("error");
    expect(syntax.message).toContain("SyntaxError");
  });

  it("exports the whole last table, not only the rows shown", async () => {
    await call("run", "df[['order_id', 'total']]");
    const fn = pyodide.globals.get("export_csv");
    const csv: string = fn();
    fn.destroy();
    expect(csv.trim().split("\n").length - 1).toBeGreaterThan(5000);
    expect(csv.startsWith("order_id,total\n")).toBe(true);
  });
});

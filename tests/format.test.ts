import {describe, expect, it} from "vitest";
import {delimiterName, formatBytes, formatCell, formatDate, formatNumber, plural, pythonString} from "../src/format";
import {cafeSalesCsv, weatherCsv} from "../src/samples";

describe("format", () => {
  it("formats numbers for reading", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(1234.5678)).toBe("1,234.57");
    expect(formatNumber(3.14159)).toBe("3.142");
    expect(formatNumber(0.000123456)).toBe("0.0001235");
    expect(formatNumber(null)).toBe("–");
  });

  it("shortens pandas dates", () => {
    expect(formatDate("2025-03-01T00:00:00.000")).toBe("2025-03-01");
    expect(formatDate("2025-03-01T08:30:00.000")).toBe("2025-03-01 08:30");
    expect(formatDate("2025-03-01T08:30:15.000")).toBe("2025-03-01 08:30:15");
  });

  it("formats cells, sizes and words", () => {
    expect(formatCell(null, "number")).toBe("");
    expect(formatCell(2.5, "number")).toBe("2.5");
    expect(formatCell(10001, "text")).toBe("10001");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(plural(1, "row")).toBe("1 row");
    expect(plural(2000, "row")).toBe("2,000 rows");
    expect(delimiterName("\t")).toBe("tab");
  });

  it("quotes column names as Python strings", () => {
    expect(pythonString('say "hi"\\')).toBe('"say \\"hi\\"\\\\"');
    expect(pythonString("a\nb")).toBe('"a\\nb"');
  });
});

describe("samples", () => {
  it("are the same every time", () => {
    expect(cafeSalesCsv()).toBe(cafeSalesCsv());
    expect(weatherCsv().split("\n")).toHaveLength(367);
  });
});

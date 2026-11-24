import {describe, expect, it} from "vitest";
import {snippetsFor} from "../src/snippets";

describe("snippetsFor", () => {
  it("writes queries for the café columns", () => {
    const snippets = snippetsFor(
      [
        {name: "order_id", kind: "integer", unique: 6000},
        {name: "date", kind: "date", unique: 365},
        {name: "shop", kind: "text", unique: 3},
        {name: "product", kind: "text", unique: 10},
        {name: "total", kind: "number", unique: 40},
      ],
      6000,
    );
    const labels = snippets.map((s) => s.label);
    expect(labels).toEqual([
      "Summary",
      "Missing values",
      "Count by shop",
      "total by shop",
      "total per month",
      "Pivot table",
      "Top 10 by total",
      "Filter rows",
      "Correlation",
    ]);
    expect(snippets[3].code).toContain('df.groupby("shop")["total"]');
  });

  it("skips grouping on columns where every value differs", () => {
    const labels = snippetsFor([{name: "email", kind: "text", unique: 900}], 900).map((s) => s.label);
    expect(labels).toEqual(["Summary", "Missing values"]);
  });
});

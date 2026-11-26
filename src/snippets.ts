// Ready-made pandas queries, written for the columns of the file that is open.
import {pythonString} from "./format";
import type {Kind} from "./protocol";

export interface Snippet {
  label: string;
  code: string;
}

interface Column {
  name: string;
  kind: Kind;
  unique?: number;
}

const col = (name: string) => `df[${pythonString(name)}]`;

export function snippetsFor(columns: readonly Column[], rows: number): Snippet[] {
  const numbers = columns.filter((c) => c.kind === "number" || c.kind === "integer");
  // A good column to group by repeats its values: few distinct values compared with the rows.
  const groups = columns
    .filter((c) => c.kind === "text" || c.kind === "boolean")
    .filter((c) => c.unique === undefined || (c.unique > 1 && c.unique <= Math.max(50, rows / 20)))
    .toSorted((a, b) => (a.unique ?? 0) - (b.unique ?? 0));
  const measure = numbers.toReversed().find((c) => !/(^|_)(id|code|zip|year)$/i.test(c.name)) ?? numbers[0];
  const group = groups[0];
  const date = columns.find((c) => c.kind === "date");
  const snippets: Snippet[] = [
    {label: "Summary", code: 'df.describe(include="all").T'},
    {label: "Missing values", code: "df.isna().sum().sort_values(ascending=False)"},
  ];
  if (group) snippets.push({label: `Count by ${group.name}`, code: `${col(group.name)}.value_counts()`});
  if (group && measure) {
    snippets.push({
      label: `${measure.name} by ${group.name}`,
      code: `(df.groupby(${pythonString(group.name)})[${pythonString(measure.name)}]\n  .agg(["count", "sum", "mean"])\n  .sort_values("sum", ascending=False)\n  .round(2))`,
    });
  }
  if (date && measure) {
    snippets.push({
      label: `${measure.name} per month`,
      code: `(df.set_index(${pythonString(date.name)})\n  .resample("MS")[${pythonString(measure.name)}]\n  .sum()\n  .round(2))`,
    });
  }
  if (group && measure && groups[1]) {
    snippets.push({
      label: "Pivot table",
      code: `df.pivot_table(\n  index=${pythonString(group.name)},\n  columns=${pythonString(groups[1].name)},\n  values=${pythonString(measure.name)},\n  aggfunc="sum",\n).round(2)`,
    });
  }
  if (measure) {
    snippets.push({
      label: `Top 10 by ${measure.name}`,
      code: `df.nlargest(10, ${pythonString(measure.name)})`,
    });
    snippets.push({
      label: "Filter rows",
      code: `df[${col(measure.name)} > ${col(measure.name)}.median()]`,
    });
  }
  if (numbers.length >= 2) snippets.push({label: "Correlation", code: 'df.select_dtypes("number").corr().round(2)'});
  return snippets;
}

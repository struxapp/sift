// Number, date and size formatting for the overview and the result table.

const compact = new Intl.NumberFormat("en", {maximumFractionDigits: 2});
const whole = new Intl.NumberFormat("en");

/** A number as people read it: thousands separated, at most 4 significant decimals for small values. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "−∞";
  if (Number.isInteger(value)) return whole.format(value);
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return compact.format(value);
  if (magnitude >= 1) return new Intl.NumberFormat("en", {maximumFractionDigits: 3}).format(value);
  return new Intl.NumberFormat("en", {maximumSignificantDigits: 4}).format(value);
}

/** An ISO date-time from pandas, without a midnight time and without milliseconds. */
export function formatDate(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(:\d{2})?(?:\.\d+)?)?/.exec(iso);
  if (!match) return iso;
  const [, date, time, seconds] = match;
  if (!time || (time === "00:00" && (!seconds || seconds === ":00"))) return date;
  return `${date} ${time}${seconds && seconds !== ":00" ? seconds : ""}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${whole.format(count)} ${count === 1 ? one : many}`;
}

export function delimiterName(delimiter: string): string {
  return {",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe"}[delimiter] ?? JSON.stringify(delimiter);
}

/** A table cell: numbers formatted when the column is numeric, ISO dates shortened, missing values as a dash. */
export function formatCell(value: unknown, kind: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return kind === "integer" || kind === "number" ? formatNumber(value) : String(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  if (kind === "date" && typeof value === "string") return formatDate(value);
  return String(value);
}

/** A Python string literal for a column name, so inserted code works with quotes and backslashes in names. */
export function pythonString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

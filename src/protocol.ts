// Messages between the page and the Python worker, and the shapes src/sift.py returns.

export type Stage = "runtime" | "packages" | "ready";

export type ToWorker =
  | {type: "init"; indexURL: string}
  | {type: "load"; id: number; bytes: Uint8Array; name: string}
  | {type: "run"; id: number; code: string}
  | {type: "columns"; id: number}
  | {type: "export"; id: number};

export type FromWorker =
  | {type: "stage"; stage: Stage}
  | {type: "fatal"; message: string}
  | {type: "result"; id: number; json: string; seconds: number}
  | {type: "failed"; id: number; message: string};

export type Kind = "integer" | "number" | "date" | "boolean" | "text";

export interface Histogram {
  counts: number[];
  edges: number[];
}

export interface ColumnSummary {
  name: string;
  kind: Kind;
  dtype: string;
  missing: number;
  unique: number;
  stats?: {min: number | null; max: number | null; mean: number | null; median: number | null; std: number | null; sum: number | null};
  range?: {min: string; max: string};
  top?: {value: string; count: number}[];
  histogram?: Histogram | null;
}

export interface TableResult {
  kind: "table";
  columns: string[];
  kinds: Kind[];
  rows: unknown[][];
  index: string[] | null;
  indexName: string | null;
  totalRows: number;
  totalColumns: number;
  stdout?: string;
}

export interface Overview {
  name: string;
  rows: number;
  encoding: string;
  delimiter: string;
  memory: number;
  columns: ColumnSummary[];
  preview: TableResult;
}

export type RunResult =
  | TableResult
  | {kind: "text"; text: string; stdout: string}
  | {kind: "none"; stdout: string}
  | {kind: "error"; message: string; line: number | null; traceback: string; stdout: string};

"""Sift's Python side: reads a CSV with pandas, describes every column and runs the person's own code.

Every public function returns a JSON string, so the Web Worker hands plain text to the page.
"""

import ast
import contextlib
import csv
import io
import json
import math
import traceback

import numpy as np
import pandas as pd

PREVIEW_ROWS = 200
HISTOGRAM_BINS = 24
TOP_VALUES = 6
OUTPUT_LIMIT = 20_000
ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")
DELIMITERS = ",;\t|"

_state = {"name": None, "last": None}
_namespace = {}


def _decode(data):
    for encoding in ENCODINGS:
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError("The file is not text.")


def _delimiter(text):
    sample = text[:65536]
    try:
        return csv.Sniffer().sniff(sample, delimiters=DELIMITERS).delimiter
    except csv.Error:
        first = sample.split("\n", 1)[0]
        counts = {d: first.count(d) for d in DELIMITERS}
        best = max(counts, key=counts.get)
        return best if counts[best] else ","


def _is_text(series):
    return pd.api.types.is_string_dtype(series) or pd.api.types.is_object_dtype(series)


def _parse_dates(df):
    """Turns text columns that hold ISO dates (2025-03-01, 2025-03-01 08:30) into datetimes."""
    for column in df.columns:
        series = df[column]
        if not _is_text(series):
            continue
        values = series.dropna().astype(str)
        if values.empty:
            continue
        if values.str.match(r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$").mean() < 0.95:
            continue
        try:
            df[column] = pd.to_datetime(series, format="ISO8601")
        except (ValueError, TypeError):
            pass
    return df


def _number(value):
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    value = float(value)
    return value if math.isfinite(value) else None


def _kind(series):
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"
    if pd.api.types.is_integer_dtype(series):
        return "integer"
    if pd.api.types.is_numeric_dtype(series):
        return "number"
    return "text"


def _histogram(values):
    if values.empty:
        return None
    counts, edges = np.histogram(values, bins=min(HISTOGRAM_BINS, max(1, values.nunique())))
    return {"counts": [int(c) for c in counts], "edges": [float(e) for e in edges]}


def _describe_column(name, series):
    kind = _kind(series)
    present = series.dropna()
    column = {
        "name": str(name),
        "kind": kind,
        "dtype": str(series.dtype),
        "missing": int(series.isna().sum()),
        "unique": int(present.nunique()),
    }
    if kind in ("integer", "number"):
        finite = present[np.isfinite(present.astype(float))]
        if not finite.empty:
            column["stats"] = {
                "min": _number(finite.min()),
                "max": _number(finite.max()),
                "mean": _number(finite.mean()),
                "median": _number(finite.median()),
                "std": _number(finite.std()) if len(finite) > 1 else None,
                "sum": _number(finite.sum()),
            }
            column["histogram"] = _histogram(finite.astype(float))
    elif kind == "date":
        if not present.empty:
            column["range"] = {"min": present.min().isoformat(), "max": present.max().isoformat()}
            column["histogram"] = _histogram(present.astype("int64") / 1e9)
    else:
        counts = present.astype(str).value_counts().head(TOP_VALUES)
        column["top"] = [{"value": str(v), "count": int(c)} for v, c in counts.items()]
    return column


def _table(frame):
    """A DataFrame as a JSON-ready table: the first rows, every column, and the index when it means something."""
    shown = frame.head(PREVIEW_ROWS)
    split = json.loads(shown.to_json(orient="split", date_format="iso", double_precision=15, default_handler=str))
    plain_index = isinstance(frame.index, pd.RangeIndex) and frame.index.start == 0 and frame.index.step == 1
    names = [n for n in frame.index.names]
    return {
        "kind": "table",
        "columns": [str(c) if not isinstance(c, tuple) else " / ".join(map(str, c)) for c in frame.columns],
        "kinds": [_kind(frame[c]) if isinstance(frame[c], pd.Series) else "text" for c in frame.columns],
        "rows": split["data"],
        "index": None if plain_index else [str(i) if not isinstance(i, tuple) else " / ".join(map(str, i)) for i in split["index"]],
        "indexName": None if plain_index else " / ".join("" if n is None else str(n) for n in names),
        "totalRows": int(len(frame)),
        "totalColumns": int(frame.shape[1]),
    }


def _result(value):
    if isinstance(value, pd.Series):
        name = value.name if value.name is not None else "value"
        return _table(value.to_frame(name=name))
    if isinstance(value, pd.DataFrame):
        return _table(value)
    if isinstance(value, pd.Index):
        return _table(value.to_frame(index=False))
    if isinstance(value, np.ndarray) and value.ndim <= 2:
        return _table(pd.DataFrame(value))
    text = repr(value)
    if len(text) > OUTPUT_LIMIT:
        text = text[:OUTPUT_LIMIT] + "\n…"
    return {"kind": "text", "text": text}


def load(data, name):
    """Reads CSV bytes into `df` and returns the overview of the file."""
    text, encoding = _decode(bytes(data))
    delimiter = _delimiter(text)
    df = pd.read_csv(io.StringIO(text), sep=delimiter, low_memory=False)
    df.columns = [str(c).strip() or f"column_{i + 1}" for i, c in enumerate(df.columns)]
    df = _parse_dates(df)
    _namespace.clear()
    _namespace.update({"df": df, "pd": pd, "np": np})
    _state["name"] = name
    _state["last"] = df
    return json.dumps({
        "name": name,
        "rows": int(len(df)),
        "encoding": encoding.replace("-sig", ""),
        "delimiter": delimiter,
        "memory": int(df.memory_usage(deep=True).sum()),
        "columns": [_describe_column(c, df[c]) for c in df.columns],
        "preview": _table(df),
    }, allow_nan=False)


def run(code):
    """Runs the person's code like a notebook cell: the value of a last expression is the result."""
    output = io.StringIO()
    try:
        tree = ast.parse(code, "<query>", "exec")
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        with contextlib.redirect_stdout(output):
            exec(compile(tree, "<query>", "exec"), _namespace)
            value = eval(compile(last, "<query>", "eval"), _namespace) if last is not None else None
    except BaseException as error:  # noqa: BLE001 - the person's code may raise anything, even SystemExit
        lines = traceback.format_exception(type(error), error, error.__traceback__)
        kept = [line for line in lines if "<query>" in line or not line.startswith("  File")]
        return json.dumps({
            "kind": "error",
            "message": f"{type(error).__name__}: {error}",
            "line": getattr(error, "lineno", None) if isinstance(error, SyntaxError) else _error_line(error),
            "traceback": "".join(kept)[-OUTPUT_LIMIT:],
            "stdout": output.getvalue()[-OUTPUT_LIMIT:],
        })
    result = _result(value) if value is not None else {"kind": "none"}
    if isinstance(value, (pd.DataFrame, pd.Series)):
        _state["last"] = value
    result["stdout"] = output.getvalue()[-OUTPUT_LIMIT:]
    return json.dumps(result, allow_nan=False, default=str)


def _error_line(error):
    tb = error.__traceback__
    line = None
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == "<query>":
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def export_csv():
    """The whole last table result (not only the rows shown) as CSV text."""
    last = _state["last"]
    if isinstance(last, pd.Series):
        last = last.to_frame()
    if last is None:
        return ""
    keep_index = not (isinstance(last.index, pd.RangeIndex) and last.index.start == 0 and last.index.step == 1)
    return last.to_csv(index=keep_index)


def columns():
    """Names and kinds of the columns of `df` as it is now (the person's code may replace it)."""
    df = _namespace.get("df")
    if not isinstance(df, pd.DataFrame):
        return json.dumps([])
    return json.dumps([{"name": str(c), "kind": _kind(df[c])} for c in df.columns])

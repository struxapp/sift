"""Sift's Python side: reads a CSV with pandas, describes every column and runs the person's own code.

Every public function returns a JSON string, so the Web Worker hands plain text to the page.
"""

import ast
import contextlib
import csv
import io
import json
import math
import re
import traceback

import numpy as np
import pandas as pd

PREVIEW_ROWS = 200
HISTOGRAM_BINS = 24
TOP_VALUES = 6
OUTPUT_LIMIT = 20_000
OUTPUT_CUT = "… earlier output cut\n"
ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")
DELIMITERS = ",;\t|"
# A text column becomes dates or clock times when at least this share of its values look like them.
DETECT_SHARE = 0.95
DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$"
TIME_PATTERN = r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$"
# order_id, id, customer-id, OrderID: whole numbers that name a row rather than measure something.
ID_NAME = re.compile(r"(?i:(^|[_\s-])id)$|[a-z](Id|ID)$")

_state = {"last": None}
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


def _header(text, delimiter):
    """The header line as written, so blank and repeated names are seen before pandas renames them."""
    try:
        return next((row for row in csv.reader(io.StringIO(text), delimiter=delimiter) if row), [])
    except csv.Error:  # a name longer than the csv module's field limit: keep the names pandas gave
        return []


def _column_names(written, count):
    """Trimmed names; a blank one becomes column_N and a repeated one name_2, name_3…"""
    if len(written) != count:
        written = [""] * count
    names, seen = [], set()
    for i, raw in enumerate(written):
        base = raw.strip() or f"column_{i + 1}"
        name, n = base, 1
        while name in seen:
            n += 1
            name = f"{base}_{n}"
        seen.add(name)
        names.append(name)
    return names


def _is_text(series):
    return pd.api.types.is_string_dtype(series) or pd.api.types.is_object_dtype(series)


def _parse_dates(df):
    """Turns text columns that hold ISO dates (2025-03-01, 2025-03-01 08:30) into datetimes.

    A few values that are not dates (at most 5%, such as "unknown") become missing.
    """
    for column in df.columns:
        series = df[column]
        if not _is_text(series):
            continue
        values = series.dropna().astype(str)
        if values.empty or values.str.match(DATE_PATTERN).mean() < DETECT_SHARE:
            continue
        try:
            df[column] = pd.to_datetime(series, format="ISO8601", errors="coerce")
        except (ValueError, TypeError):
            pass
    return df


def _time_seconds(values):
    """Seconds since midnight for values like 8:30 or 17:45:10; None when too few values are clock times."""
    parts = values.astype(str).str.extract(TIME_PATTERN).astype(float)
    valid = (parts[0] < 24) & (parts[1] < 60) & ~(parts[2] >= 60)
    if values.empty or valid.mean() < DETECT_SHARE:
        return None
    return (parts[0] * 3600 + parts[1] * 60 + parts[2].fillna(0))[valid]


def _clock(seconds, with_seconds):
    seconds = int(seconds)
    clock = f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}"
    return f"{clock}:{seconds % 60:02d}" if with_seconds else clock


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
    # A gap turns a whole-number column into decimals in pandas, so whole values count, whatever the dtype.
    whole = kind == "integer" or (kind == "number" and not present.empty and bool((present % 1 == 0).all()))
    if whole and ID_NAME.search(str(name)) and not present.empty and present.is_unique:
        column["identifier"] = True
        column["range"] = {"min": str(int(present.min())), "max": str(int(present.max()))}
    elif kind in ("integer", "number"):
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
        seconds = _time_seconds(present) if kind == "text" and not present.empty else None
        if seconds is not None:
            column["kind"] = "time"
            with_seconds = bool((seconds % 60).any())
            column["range"] = {"min": _clock(seconds.min(), with_seconds), "max": _clock(seconds.max(), with_seconds)}
            column["histogram"] = _histogram(seconds)
        else:
            counts = present.astype(str).value_counts().head(TOP_VALUES)
            column["top"] = [{"value": str(v), "count": int(c)} for v, c in counts.items()]
    return column


def _label(value):
    """An index or column label as text; the levels of a MultiIndex (tuples, or lists after JSON) joined by /."""
    return " / ".join(map(str, value)) if isinstance(value, (tuple, list)) else str(value)


def _table(frame):
    """A DataFrame as a JSON-ready table: the first rows, every column, and the index when it means something."""
    shown = frame.head(PREVIEW_ROWS)
    split = json.loads(shown.to_json(orient="split", date_format="iso", double_precision=15, default_handler=str))
    plain_index = isinstance(frame.index, pd.RangeIndex) and frame.index.start == 0 and frame.index.step == 1
    return {
        "kind": "table",
        "columns": [_label(c) for c in frame.columns],
        "kinds": [_kind(frame[c]) if isinstance(frame[c], pd.Series) else "text" for c in frame.columns],
        "rows": split["data"],
        "index": None if plain_index else [_label(i) for i in split["index"]],
        "indexName": None if plain_index else " / ".join("" if n is None else str(n) for n in frame.index.names),
        "totalRows": int(len(frame)),
        "totalColumns": int(frame.shape[1]),
    }


def _result(value):
    if isinstance(value, pd.Series):
        name = value.name if value.name is not None else "value"
        return _table(value.to_frame(name=name))
    if isinstance(value, pd.DataFrame):
        return _table(value)
    if isinstance(value, pd.MultiIndex):
        return _table(value.to_frame(index=False))
    if isinstance(value, pd.Index):
        return _table(value.to_frame(index=False, name=value.name if value.name is not None else "value"))
    # unique() gives a NumPy array, or a pandas array for text columns.
    if isinstance(value, pd.api.extensions.ExtensionArray) or (isinstance(value, np.ndarray) and value.ndim == 1):
        return _table(pd.DataFrame({"value": value}))
    if isinstance(value, np.ndarray) and value.ndim == 2:
        return _table(pd.DataFrame(value))
    if isinstance(value, (np.number, np.bool_)):
        value = value.item()  # 4, not np.int64(4) as NumPy 2 writes it
    text = repr(value)
    if len(text) > OUTPUT_LIMIT:
        text = text[:OUTPUT_LIMIT] + "\n…"
    return {"kind": "text", "text": text}


def _tail(text):
    """The end of long output, which is where the latest lines are, marked when the start was cut."""
    return text if len(text) <= OUTPUT_LIMIT else OUTPUT_CUT + text[-OUTPUT_LIMIT:]


def load(data, name):
    """Reads CSV bytes into `df` and returns the overview of the file."""
    text, encoding = _decode(bytes(data))
    delimiter = _delimiter(text)
    try:
        df = pd.read_csv(io.StringIO(text), sep=delimiter, low_memory=False)
    except pd.errors.EmptyDataError:
        raise ValueError("There are no columns in this file. The first line should name them.") from None
    df.columns = _column_names(_header(text, delimiter), len(df.columns))
    df = _parse_dates(df)
    _namespace.clear()
    _namespace.update({"df": df, "pd": pd, "np": np})
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
            # Showing the value runs the person's code too (a __repr__), so its errors become an error card as well.
            result = _result(value) if value is not None else {"kind": "none"}
        result["stdout"] = _tail(output.getvalue())
        text = json.dumps(result, allow_nan=False, default=str)
    except BaseException as error:  # noqa: BLE001 - the person's code may raise anything, even SystemExit
        lines = traceback.format_exception(type(error), error, error.__traceback__)
        kept = [line for line in lines if "<query>" in line or not line.startswith("  File")]
        return json.dumps({
            "kind": "error",
            "message": f"{type(error).__name__}: {error}",
            "line": getattr(error, "lineno", None) if isinstance(error, SyntaxError) else _error_line(error),
            "traceback": "".join(kept)[-OUTPUT_LIMIT:],
            "stdout": _tail(output.getvalue()),
        })
    if isinstance(value, (pd.DataFrame, pd.Series)):
        _state["last"] = value
    return text


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

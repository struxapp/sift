# Sift

Sift lets you explore a CSV file with pandas, right in your browser. Python runs on the page (Pyodide), so your file
is never uploaded anywhere.

- **Open a file** by choosing it, dropping it on the page or pasting rows (for example copied from a spreadsheet).
  Comma, semicolon, tab and pipe separators and UTF-8 or Windows-1252 text are detected for you; ISO dates become
  real dates. Up to 100 MB.
- **Every column described**: its type, missing values, distinct values, min / median / mean / max with a small
  histogram for numbers, the date range for dates, and the most common values for text. Find a column by name.
- **Ask in pandas**: `df` is your file, `pd` and `np` are ready. Code runs like a notebook cell: the value of the last
  line is the result, and variables you make stay for the next run. `print` output is shown too.
- **Ready-made queries** written for your columns: summary, missing values, counts, group totals, values per month,
  a pivot table, top 10, a filter and correlations. Click one to run it, then change it.
- **Results** as a table (the first 200 rows, the index when it means something) or as a value. **CSV** downloads
  the whole result, not only the rows shown.
- **Errors** name the line of your code that failed, with the Python traceback one click away.
- **Stop** ends a query that runs too long: Python starts again and your file opens again.
- Two **examples** made up for Sift: a year of café orders and a year of weather readings with a few gaps.
- Light and dark themes, keyboard friendly (`Ctrl` + `Enter` runs), works from 360 px wide.

Nothing is sent anywhere: Pyodide, pandas and NumPy are served from this App's own files, not from a CDN. Only the
theme choice is stored (localStorage).

## Run it

```sh
npm ci
npm run dev      # local development server
npm test         # unit tests (Vitest), including src/sift.py in the real Pyodide
npm run build    # type-check and build to dist/
npm run preview  # serve dist/
```

Node 22 or newer. The build copies Pyodide's runtime from the `pyodide` npm package and the Python wheels from
`vendor/pyodide-packages` into `dist/pyodide/`; it downloads nothing but npm packages.

## How Python is loaded

- `pyodide` (npm, 314.0.8: Python 3.14) gives the runtime: `pyodide.asm.wasm`, `python_stdlib.zip`, the loader and
  `pyodide-lock.json`.
- The npm package does not include pandas, so `vendor/pyodide-packages` holds the five wheels Sift needs (numpy,
  pandas, python-dateutil, pytz, six; 7.6 MB). `npm run vendor` downloads them from Pyodide's official distribution
  and checks each one against the SHA-256 in `pyodide-lock.json`; run it after changing the `pyodide` version and
  commit the result.
- Python runs in a Web Worker, so the page never freezes. It needs no special headers: no SharedArrayBuffer, so no
  cross-origin isolation (COOP/COEP). The output is about 21 MB; a returning visitor gets it from the browser cache.

## Code map

- `src/sift.py`: the Python side: reading the CSV, describing columns, running queries, exporting the result.
- `src/python.worker.ts`: starts Pyodide in a Web Worker and calls `sift.py`.
- `src/main.ts`: the page; `src/snippets.ts` writes the ready-made queries; `src/format.ts` formats numbers and
  dates; `src/samples.ts` generates the examples (seeded, the same every time).
- `vite.config.ts`: serves and copies Pyodide's files to `pyodide/`.
- `tests/`: `sift.py` in the real Pyodide, the query suggestions and the formatting.

## Sources and licences

- Pyodide (MPL 2.0), pandas (BSD 3-Clause), NumPy (BSD 3-Clause), python-dateutil (Apache 2.0 / BSD), pytz (MIT),
  six (MIT): unchanged files from Pyodide's distribution.
- Fonts: Geist and Geist Mono, bundled through `@fontsource-variable` packages, SIL Open Font License 1.1.
- Icons: shapes adapted from Lucide (ISC licence).
- The example data was made up for this App.

## Licence

MIT, see [LICENSE](LICENSE).

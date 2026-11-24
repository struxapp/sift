// Downloads the Python wheels Sift needs from Pyodide's official distribution and checks each one against the
// SHA-256 in the pyodide-lock.json of the installed `pyodide` npm package. Run it once after changing the pyodide
// version (npm run vendor), then commit vendor/pyodide-packages. Builds never download anything but npm packages.
import {createHash} from "node:crypto";
import {mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

export const PACKAGES = ["numpy", "pandas", "python-dateutil", "pytz", "six"];

const root = fileURLToPath(new URL("..", import.meta.url));
const lock = JSON.parse(await readFile(`${root}node_modules/pyodide/pyodide-lock.json`, "utf8"));
const {version} = JSON.parse(await readFile(`${root}node_modules/pyodide/package.json`, "utf8"));
const target = `${root}vendor/pyodide-packages/`;
await mkdir(target, {recursive: true});
const wanted = new Set(PACKAGES.map((name) => lock.packages[name].file_name));
for (const file of await readdir(target)) if (!wanted.has(file)) await rm(target + file);

for (const name of PACKAGES) {
  const entry = lock.packages[name];
  const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${entry.file_name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== entry.sha256) throw new Error(`${entry.file_name}: SHA-256 ${sha256} does not match the lock file`);
  await writeFile(target + entry.file_name, bytes);
  console.log(`${entry.file_name}  ${(bytes.length / 1048576).toFixed(1)} MB  sha256 ok`);
}

import {createReadStream, existsSync} from "node:fs";
import {copyFile, mkdir, readdir} from "node:fs/promises";
import {join, resolve} from "node:path";
import {defineConfig, type Plugin} from "vite";

// Pyodide is served from this App's own files, never from a CDN: the npm package's runtime and the vendored wheels
// (scripts/vendor-packages.mjs) both go to pyodide/ next to index.html, with the lock file that lists them.
const CORE = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
const coreDir = resolve("node_modules/pyodide");
const wheelDir = resolve("vendor/pyodide-packages");

function sourceOf(file: string): string | null {
  if (!/^[\w.-]+$/.test(file)) return null;
  if (CORE.includes(file)) return join(coreDir, file);
  if (file.endsWith(".whl") && existsSync(join(wheelDir, file))) return join(wheelDir, file);
  return null;
}

function pyodideFiles(): Plugin {
  let outDir = "dist";
  return {
    name: "sift-pyodide-files",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use("/pyodide/", (request, response, next) => {
        const source = sourceOf((request.url ?? "").split("?")[0].replace(/^\//, ""));
        if (!source) return next();
        const type = source.endsWith(".wasm") ? "application/wasm" : source.endsWith(".mjs") ? "text/javascript" : source.endsWith(".json") ? "application/json" : "application/octet-stream";
        response.setHeader("content-type", type);
        createReadStream(source).pipe(response);
      });
    },
    async writeBundle() {
      const target = join(outDir, "pyodide");
      await mkdir(target, {recursive: true});
      const wheels = (await readdir(wheelDir)).filter((file) => file.endsWith(".whl"));
      for (const file of CORE) await copyFile(join(coreDir, file), join(target, file));
      for (const file of wheels) await copyFile(join(wheelDir, file), join(target, file));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [pyodideFiles()],
  worker: {format: "es"},
  build: {target: "es2022"},
});

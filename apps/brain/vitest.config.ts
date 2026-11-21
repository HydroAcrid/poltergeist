import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
const contractsSrc = resolve(here, "../../packages/contracts/src");
const shimDir = resolve(here, "test/shims/contracts");

/**
 * Until World's scaffold is on main: resolve `@poltergeist/contracts/<file>`
 * and relative imports between contract files to the real file when it
 * exists, otherwise to a shim in test/shims/contracts. Remove once the
 * workspace package exists.
 */
function contractsFallback(): Plugin {
  const pick = (file: string) => {
    const ts = file.replace(/\.js$/, ".ts");
    for (const dir of [contractsSrc, shimDir]) {
      const candidate = join(dir, ts);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };
  return {
    name: "contracts-fallback",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.startsWith("@poltergeist/contracts/")) {
        return pick(source.slice("@poltergeist/contracts/".length));
      }
      if (importer && source.startsWith("./") && /\.js$/.test(source)) {
        const from = resolve(dirname(importer));
        if (from === contractsSrc || from === shimDir) return pick(source.slice(2));
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [contractsFallback()],
  resolve: {
    alias: [{ find: /^zod$/, replacement: fileURLToPath(import.meta.resolve("zod")) }],
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});

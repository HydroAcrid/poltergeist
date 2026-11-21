// Crowd's Gemini keys. They live in a private file outside the repo (named by PG_CROWD_ENV_FILE,
// readable only by its owner) or in host secrets, and are read into this module only: never
// into process.env, never logged, never sent to a browser.
import { readFileSync, statSync } from "node:fs";

export interface CrowdKeys {
  keys: string[];
  source: "private file" | "environment" | "GEMINI_API_KEY" | "none";
}

const NAMES = ["PG_CROWD_GEMINI_KEY", "PG_CROWD_GEMINI_KEY_2"] as const;

/** Minimal KEY=value parser (comments, blank lines, optional quotes). Values are never echoed. */
function parse(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function readPrivateFile(path: string, log?: (msg: string) => void): Record<string, string> {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch {
    return {};
  }
  if (mode & 0o077) {
    log?.(`Crowd key file is readable by other users; not using it. Run: chmod 600 ${path}`);
    return {};
  }
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    log?.("Crowd key file could not be read; not using it.");
    return {};
  }
}

const clean = (values: (string | undefined)[]) => [...new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))];

/**
 * Crowd's keys, in order: the private file (PG_CROWD_ENV_FILE), then PG_CROWD_GEMINI_KEY(_2) in the
 * environment, then World's shared GEMINI_API_KEY as a last resort.
 */
export function loadCrowdGeminiKeys(env: Record<string, string | undefined>, log?: (msg: string) => void): CrowdKeys {
  if (env.PG_CROWD_ENV_FILE) {
    const file = readPrivateFile(env.PG_CROWD_ENV_FILE, log);
    const keys = clean(NAMES.map((n) => file[n]));
    if (keys.length) return { keys, source: "private file" };
  }
  const fromEnv = clean(NAMES.map((n) => env[n]));
  if (fromEnv.length) return { keys: fromEnv, source: "environment" };
  const shared = clean([env.GEMINI_API_KEY]);
  if (shared.length) return { keys: shared, source: "GEMINI_API_KEY" };
  return { keys: [], source: "none" };
}

/** Never let a key leak through an error message or a provider's echo. */
export function redact(text: string, keys: readonly string[]): string {
  let out = text;
  for (const k of keys) if (k) out = out.split(k).join("[key]");
  return out.replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]");
}

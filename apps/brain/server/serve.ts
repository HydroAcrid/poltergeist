// Standalone Brain tick server, until World's hub mounts Brain as a LaneModule.
//
//   pnpm --dir apps/brain serve
//
// Env (the repo's git-ignored .env is loaded if present):
//   PG_PERCEPTION   er2 | fixture   (default: er2 when GEMINI_API_KEY is set, else fixture)
//   GEMINI_API_KEY  required for er2; never logged
//   PG_MODEL_PERCEPTION             (default gemini-robotics-er-2-preview)
//   HOST            127.0.0.1 by default; 0.0.0.0 to accept World's host over the LAN
//   PORT            8790 by default
//   PG_DATA_DIR     where frames/<seq>.jpg and ticks.jsonl go (default apps/brain/data, git-ignored)
//   PG_TARGET_LABEL / PG_INSTRUCTION   the task (default: the hallway exit)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { buildServer } from "./http.js";
import { DEFAULT_MODEL, Er2Perception } from "./perception/er2.js";
import { FixturePerception } from "./perception/fixture.js";
import type { PerceptionAdapter } from "./perception/types.js";
import { loadPolicy } from "./policy.js";
import { TickHandler } from "./tick.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
if (existsSync(join(repoRoot, ".env"))) process.loadEnvFile(join(repoRoot, ".env"));

const env = process.env;
const policyVersion = env.PG_POLICY ?? "v1";
const policy = loadPolicy(policyVersion);
const kind = env.PG_PERCEPTION ?? (env.GEMINI_API_KEY ? "er2" : "fixture");
const model = env.PG_MODEL_PERCEPTION || DEFAULT_MODEL;

let adapter: PerceptionAdapter;
if (kind === "er2") {
  if (!env.GEMINI_API_KEY) throw new Error("PG_PERCEPTION=er2 needs GEMINI_API_KEY (run `pnpm --dir apps/brain set-key`).");
  adapter = new Er2Perception(new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, apiVersion: "v1beta" }), model);
} else if (kind === "fixture") {
  adapter = new FixturePerception();
} else {
  throw new Error(`PG_PERCEPTION must be er2 or fixture, got ${kind}`);
}

const task = {
  targetLabel: env.PG_TARGET_LABEL ?? "exit",
  instruction: env.PG_INSTRUCTION ?? "Walk to the exit at the far end of the hallway.",
};
const handler = new TickHandler({ adapter, policy, taskFor: () => task });
const app = buildServer({
  handler,
  dataDir: env.PG_DATA_DIR ? resolve(env.PG_DATA_DIR) : join(here, "../data"),
  policy: { version: policy.version, yaml: readFileSync(join(here, "../policies", `${policyVersion}.yaml`), "utf8") },
  perception: kind === "er2" ? `er2 (${model})` : "fixture",
  log: true,
});

const host = env.HOST ?? "127.0.0.1";
const port = Number(env.PORT ?? 8790);
await app.listen({ host, port });
console.log(`Brain tick server: http://${host}:${port}/api/brain/tick · perception ${kind === "er2" ? `er2 (${model})` : "fixture"} · policy ${policy.version}`);

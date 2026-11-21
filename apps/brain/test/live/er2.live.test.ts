// @live: calls the real Gemini Robotics-ER 2 API. Runs only via
// `pnpm --dir apps/brain probe:live` (vitest --mode live), with GEMINI_API_KEY
// in the repo's git-ignored .env. Measures ER 2 on World's labeled frames and
// writes apps/brain/EVALS.md. The key is never printed or written.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { initialState } from "../../server/controller.js";
import { feetMidpoint, stepNav } from "../../server/navigate.js";
import { DEFAULT_MODEL, Er2Perception } from "../../server/perception/er2.js";
import { WORLD_FLASHLIGHT, WORLD_HALLWAY, loadHallwayLabels } from "../../server/perception/fixture.js";
import type { Scene } from "../../server/perception/types.js";
import { loadPolicy } from "../../server/policy.js";
import { req } from "../helpers.js";

const repoRoot = resolve(__dirname, "../../../..");
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.PG_MODEL_PERCEPTION || DEFAULT_MODEL;

const HIT = 80; // CONTRACTS C12 hit radius, 0–1000 space
const PROBE_TIMEOUT_MS = 20_000; // generous, so we see true latency; the tick budget is policy.perception.timeoutMs
const task = { targetLabel: "exit", instruction: "Walk to the exit at the far end of the hallway." };
const dist = (a: readonly number[], b: readonly number[]) => Math.round(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!));
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;

const sets = [
  { name: "prototype", dir: WORLD_HALLWAY },
  { name: "live flashlight", dir: WORLD_FLASHLIGHT },
];

describe.skipIf(process.env.PG_LIVE !== "1")("@live ER 2 probe on World's labeled frames", () => {
  it("measures ER 2 perception, the resulting move and latency", async () => {
    expect(apiKey, "GEMINI_API_KEY missing: run `pnpm --dir apps/brain set-key` first").toBeTruthy();
    const ai = new GoogleGenAI({ apiKey: apiKey!, apiVersion: "v1beta" });
    const adapter = new Er2Perception(ai, model);
    const policy = loadPolicy("v1");
    const rows: Record<string, unknown>[] = [];
    const latencies: number[] = [];

    for (const set of sets) {
      for (const f of loadHallwayLabels(set.dir).frames) {
        const b64 = readFileSync(join(set.dir, f.file)).toString("base64");
        const t0 = performance.now();
        const r = await adapter.perceive({ frame: { mime: "image/jpeg", width: 640, height: 360, b64 }, ...task }, { timeoutMs: PROBE_TIMEOUT_MS, promptAddenda: [] });
        const ms = Math.round(performance.now() - t0);
        latencies.push(ms);

        const truth: Scene = {
          feet: f.feet,
          obstacles: f.hazard ? [{ point: f.hazard.point, ...(f.hazard.box ? { box: f.hazard.box } : {}) }] : [],
          goal: f.goal,
          pose: f.stumbling ? "stumbling" : "upright",
        };
        const truthMove = stepNav(initialState(), truth, req(0), policy).action.key;
        const s = r.scene;
        const er2Move = s ? stepNav(initialState(), s, req(0), policy).action.key : r.error ? `error:${r.error}` : "no robot";
        const truthObstacle = f.hazard ? (f.hazard.box ? [f.hazard.box[2], Math.round((f.hazard.box[1] + f.hazard.box[3]) / 2)] : f.hazard.point) : undefined;
        const nearest = truthObstacle && s?.obstacles.length
          ? Math.min(...s.obstacles.map((o) => dist(o.box ? [o.box[2], Math.round((o.box[1] + o.box[3]) / 2)] : o.point, truthObstacle)))
          : undefined;

        rows.push({
          set: set.name,
          frame: f.file,
          ms,
          error: r.error ?? "",
          robot: s ? "yes" : "no",
          feetErr: s ? dist(feetMidpoint(s), feetMidpoint(truth)) : "",
          exitErr: s?.goal ? dist(s.goal, f.goal) : r.point ? dist(r.point, f.goal) : "not seen",
          obstacle: f.hazard ? (nearest === undefined ? "missed" : `${nearest <= HIT ? "hit" : "off"} (${nearest})`) : s?.obstacles.length ? `extra ×${s.obstacles.length}` : "none (ok)",
          labels: r.hazards.map((h) => h.label).join(", "),
          pose: s ? (s.pose === truth.pose ? `${s.pose} ✓` : `${s.pose} ✗`) : "",
          forward: s?.forward ? "yes" : "no",
          move: `${er2Move} (labels → ${truthMove})${er2Move === truthMove ? " ✓" : ""}`,
          raw: adapter.lastRaw,
        });
        console.log(`${set.name} ${f.file}: ${ms} ms, move ${er2Move} vs ${truthMove}`);
      }
    }

    const ok = rows.filter((r) => !r.error);
    const within = (k: string) => ok.filter((r) => typeof r[k] === "number" && (r[k] as number) <= HIT).length;
    const summary = {
      model,
      ranAt: new Date().toISOString(),
      frames: rows.length,
      errors: rows.length - ok.length,
      robotFound: ok.filter((r) => r.robot === "yes").length,
      feetHits: within("feetErr"),
      exitHits: within("exitErr"),
      obstacleHits: rows.filter((r) => String(r.obstacle).startsWith("hit")).length,
      obstacleFrames: rows.filter((r) => !String(r.obstacle).startsWith("none") && !String(r.obstacle).startsWith("extra")).length,
      moveMatches: rows.filter((r) => String(r.move).endsWith("✓")).length,
      latencyP50: pct(latencies, 50),
      latencyP95: pct(latencies, 95),
      tickBudgetMs: policy.perception.timeoutMs,
    };

    const cols = ["set", "frame", "ms", "robot", "feetErr", "exitErr", "obstacle", "labels", "pose", "forward", "move", "error"];
    const table = [
      `| ${cols.join(" | ")} |`,
      `|${cols.map(() => "---").join("|")}|`,
      ...rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "").replaceAll("|", "/")).join(" | ")} |`),
    ].join("\n");
    const md = `# Brain evals

## ER 2 live probe: ${summary.ranAt}

Model \`${model}\`, ${summary.frames} World-labeled third-person frames (6 prototype from \`apps/world/painted-door/haunting/fixtures\`, 2 live flashlight from \`apps/world/robot-v1/fixtures\`). One call per frame, no retries beyond the adapter's single parse retry. Errors are in 0–1000 frame units; a hit is ≤ ${HIT} (CONTRACTS C12). "move" compares Brain's controller on ER 2's scene with the same controller on World's labels.

- Robot found: **${summary.robotFound}/${summary.frames}**; API/parse errors: ${summary.errors}
- Feet within ${HIT}: **${summary.feetHits}/${summary.robotFound}**; exit within ${HIT}: **${summary.exitHits}/${summary.frames}**
- Obstacle found where labeled: **${summary.obstacleHits}/${summary.obstacleFrames}**
- Same move as on the labels: **${summary.moveMatches}/${summary.frames}**
- Latency p50 **${summary.latencyP50} ms**, p95 **${summary.latencyP95} ms** (tick perception budget ${summary.tickBudgetMs} ms)

${table}

Raw ER 2 replies: \`apps/brain/evals/er2-probe-raw.json\`.
`;
    mkdirSync(resolve(__dirname, "../../evals"), { recursive: true });
    writeFileSync(resolve(__dirname, "../../EVALS.md"), md);
    writeFileSync(resolve(__dirname, "../../evals/er2-probe-raw.json"), JSON.stringify({ summary, rows }, null, 2) + "\n");
    console.log(JSON.stringify(summary, null, 2));

    // A probe: it reports accuracy rather than gating on it. It fails only if
    // the API itself is unusable (every call errored).
    expect(summary.errors, "every ER 2 call failed; check the key and model id").toBeLessThan(summary.frames);
  });
});

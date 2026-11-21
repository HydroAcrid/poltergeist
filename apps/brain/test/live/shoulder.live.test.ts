// @live: real Gemini Robotics-ER 2 on Brain's SYNTHETIC over-the-shoulder frames
// (fixtures/media/fixture-zero/shoulder), shoulder rig. Runs only via
// `pnpm --dir apps/brain probe:live`. Writes apps/brain/evals/shoulder-probe.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { initialState } from "../../server/controller.js";
import { stepNav } from "../../server/navigate.js";
import { DEFAULT_MODEL, Er2Perception } from "../../server/perception/er2.js";
import { loadPolicy, withRig } from "../../server/policy.js";
import { req } from "../helpers.js";

const repoRoot = resolve(__dirname, "../../../..");
if (existsSync(join(repoRoot, ".env"))) process.loadEnvFile(join(repoRoot, ".env"));
const model = process.env.PG_MODEL_PERCEPTION || DEFAULT_MODEL;
const dir = join(repoRoot, "fixtures/media/fixture-zero/shoulder");
const task = { targetLabel: "exit", instruction: "Walk to the exit at the far end of the hallway." };
const dist = (a: readonly number[], b: readonly number[]) => Math.round(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!));

/** Does a move satisfy the frame's human `expect` label? */
const ok: Record<string, (key: string, mode: string) => boolean> = {
  walk: (k) => k === "W",
  hold: (k) => k === "NOOP",
  arrive: (_k, m) => m === "success",
  "not-into-right": (k) => k !== "D" && k !== "ArrowRight",
  "not-into-left": (k) => k !== "A" && k !== "ArrowLeft",
  judgment: () => true,
};

describe.skipIf(process.env.PG_LIVE !== "1")("@live ER 2 on synthetic shoulder-POV frames", () => {
  it("reports what ER 2 sees with the boots hidden, and Brain's move", async () => {
    expect(process.env.GEMINI_API_KEY, "run `pnpm --dir apps/brain set-key` first").toBeTruthy();
    const policy = withRig(loadPolicy("v1"), "shoulder");
    const adapter = new Er2Perception(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, apiVersion: "v1beta" }), model, undefined, policy.navigation.shoulder.anchor);
    const labels = JSON.parse(readFileSync(join(dir, "labels.json"), "utf8"));
    const rows: string[] = [];
    let found = 0, exitHits = 0, satisfied = 0;
    const lat: number[] = [];

    for (const f of labels.frames) {
      const b64 = readFileSync(join(dir, f.file)).toString("base64");
      const r = await adapter.perceive({ frame: { mime: "image/jpeg", width: 640, height: 360, b64 }, ...task }, { timeoutMs: 20_000, promptAddenda: [], thinking: "low" });
      lat.push(r.latencyMs);
      const s = r.scene;
      if (s) found++;
      const exitErr = r.point ? dist(r.point, f.goal) : undefined;
      if (exitErr !== undefined && exitErr <= 80) exitHits++;
      const d = s ? stepNav(initialState(), s, req(0), policy) : undefined;
      const key = d?.action.key ?? (r.error ? `error:${r.error}` : "no robot");
      const good = d ? ok[f.expect]!(d.action.key, d.mode) : false;
      if (good) satisfied++;
      rows.push(`| ${f.file} | ${r.latencyMs} | ${s ? (s.feetEstimated ? "yes (boots hidden)" : "yes (boots seen)") : "no"} | ${exitErr ?? "not seen"} | ${r.hazards.map((h) => h.label).join(", ") || "none"} | ${s?.pose ?? ""} | ${key} · ${d?.rationale ?? ""} | ${f.expect} ${good ? "✓" : "✗"} |`);
      console.log(f.file, r.latencyMs, "ms", key, good ? "ok" : "MISS", d?.rationale ?? "");
    }
    lat.sort((a, b) => a - b);
    const md = `# ER 2 on synthetic shoulder-POV frames: ${new Date().toISOString()}

**Synthetic frames** (AI-generated, see \`fixtures/media/fixture-zero/shoulder/README.md\`), model \`${model}\`, shoulder rig (estimated ground anchor ${JSON.stringify(policy.navigation.shoulder.anchor)}).

- Robot found: **${found}/${labels.frames.length}**; exit within 80 units: **${exitHits}/${labels.frames.length}**
- Move satisfies the frame's human \`expect\` label: **${satisfied}/${labels.frames.length}**
- Latency p50 ${lat[Math.floor(lat.length / 2)]} ms, max ${lat.at(-1)} ms

| frame | ms | robot | exitErr | hazards | pose | move · rationale | expect |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
    mkdirSync(resolve(__dirname, "../../evals"), { recursive: true });
    writeFileSync(resolve(__dirname, "../../evals/shoulder-probe.md"), md);
    expect(found).toBeGreaterThan(0);
  });
});

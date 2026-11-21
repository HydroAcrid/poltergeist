// @live: the player model choosing its own reaction (decision mode "model") on
// Brain's SYNTHETIC shoulder-POV frames. Each case is two ticks through the real
// TickHandler: the plain hallway, then the event frame, so the model sees what
// changed. Same instruction and code for every case. Writes evals/reaction-probe.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, Er2Perception, buildDecisionPrompt } from "../../server/perception/er2.js";
import { loadPolicy, withDecision, withRig } from "../../server/policy.js";
import { TickHandler } from "../../server/tick.js";
import { req } from "../helpers.js";

const repoRoot = resolve(__dirname, "../../../..");
if (existsSync(join(repoRoot, ".env"))) process.loadEnvFile(join(repoRoot, ".env"));
const model = process.env.PG_MODEL_PERCEPTION || DEFAULT_MODEL;
const dir = join(repoRoot, "fixtures/media/fixture-zero/shoulder");
const genieDir = join(repoRoot, "fixtures/media/fixture-zero/shoulder-genie");
// "genie:<file>" = World's real Genie frames; anything else = Brain's synthetic frames.
const b64 = (f: string) => readFileSync(f.startsWith("genie:") ? join(genieDir, f.slice(6)) : join(dir, f)).toString("base64");
const task = { targetLabel: "exit", instruction: "Walk to the exit at the far end of the hallway." };

const CASES: { name: string; frames: string[]; kevin?: boolean; genie?: boolean }[] = [
  { name: "foil crossing the next footstep", frames: ["clear-route.jpg", "foil-crossing.jpg"], kevin: true },
  { name: "foil beside the robot, off the route", frames: ["clear-route.jpg", "foil-beside.jpg"], kevin: true },
  { name: "foil requested but absent from the frames", frames: ["clear-route.jpg", "absent.jpg"], kevin: true },
  { name: "chair 1-2 strides ahead, right of the line", frames: ["clear-route.jpg", "chair-next-step.jpg"] },
  { name: "chair on the route, open floor to its right", frames: ["clear-route.jpg", "chair-ahead-right-open.jpg"] },
  { name: "robot stumbling", frames: ["clear-route.jpg", "stumbling.jpg"] },
  { name: "exit threshold in the foreground (twice)", frames: ["at-exit.jpg", "at-exit.jpg"] },
  { name: "GENIE frame 1: two robots (World's hold case)", frames: ["genie:shoulder-double.jpg", "genie:shoulder-double.jpg"], genie: true },
  { name: "GENIE frame 1 → 123: papers appear", frames: ["genie:shoulder-double.jpg", "genie:windup-papers.jpg"], genie: true },
  { name: "GENIE frame 123 → 151: penguins appear", frames: ["genie:windup-papers.jpg", "genie:windup-penguins.jpg"], genie: true },
];

describe.skipIf(process.env.PG_LIVE !== "1")("@live player model chooses its own reaction", () => {
  it("runs every case with the same instruction and code", async () => {
    expect(process.env.GEMINI_API_KEY, "run `pnpm --dir apps/brain set-key` first").toBeTruthy();
    const base = withDecision(withRig(loadPolicy("v1"), "shoulder"), "model");
    // Generous timeout so the report shows the model's true latency; the live tick budget is 2500 ms.
    const policy = { ...base, perception: { ...base.perception, timeoutMs: 20_000 } };
    const rows: string[] = [];
    const prompts = new Set<string>();

    for (const c of CASES) {
      const adapter = new Er2Perception(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, apiVersion: "v1beta" }), model, undefined, policy.navigation.shoulder.anchor);
      const handler = new TickHandler({ adapter, policy, taskFor: () => task });
      await handler.handle(req(0, b64(c.frames[0]!)));
      const res = await handler.handle(req(1, b64(c.frames[1]!)));
      const raw = (() => { try { return JSON.parse(adapter.lastRaw); } catch { return {}; } })();
      prompts.add(buildDecisionPrompt({ frame: { mime: "image/jpeg", width: 640, height: 360, b64: "x" }, previousFrame: { mime: "image/jpeg", width: 640, height: 360, b64: "y" }, ...task }));
      const solid = (raw.obstacles ?? []).map((o: any) => `${o.label}${o.solid ? " (solid)" : " (not solid)"}`).join(", ") || "none";
      const d = res.decision;
      rows.push(`| ${c.kevin ? "**" : ""}${c.name}${c.kevin ? "**" : ""} | ${res.perception.latencyMs} | ${raw.robotCount ?? ""} | ${d?.observed ?? raw.change ?? ""} | ${solid} | ${d?.blocked ? "yes" : "no"} | ${raw.intent ?? ""} | ${d?.source ?? "(no decision)"} | \`${res.action.key}\` · ${res.rationale} | ${raw.pose ?? ""} |`);
      console.log(`${c.name}: ${res.perception.latencyMs} ms · robots ${raw.robotCount} · model ${raw.intent} → ${d?.source} ${res.action.key} · blocked ${d?.blocked} · "${res.rationale}" · saw: ${d?.observed ?? raw.change}`);
    }

    const md = `# Player model chooses its own reaction: ${new Date().toISOString()}

Decision mode \`model\` (\`server/react.ts\` + \`buildDecisionPrompt\` in \`server/perception/er2.ts\`), model \`${model}\`, shoulder rig, on **synthetic** frames (\`fixtures/media/fixture-zero/shoulder\`) and three of World's **real Genie** shoulder frames (\`fixtures/media/fixture-zero/shoulder-genie\`, rows marked GENIE). Each case: tick 0 = the first frame, tick 1 = the event frame; the model gets both images. **One prompt for every case** (${prompts.size} distinct): no object names, no audience text, no presets.

**Bold** rows are World's three foil cases. "model chose" is the model's own intent; "source" says whether it stood (\`model\`), geometry overrode a step into something it judged solid (\`veto\`), or a fixed rule applied (\`geometry\`: stumble, arrival).

| case | ms | robots | what the model says changed (presence) | obstacles it reported | blocked (path obstruction) | model chose | source | final action · reason (response) | pose (scare if stumbling) |
|---|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
    mkdirSync(resolve(__dirname, "../../evals"), { recursive: true });
    writeFileSync(resolve(__dirname, "../../evals/reaction-probe.md"), md);
    expect(prompts.size).toBe(1);
  });
});

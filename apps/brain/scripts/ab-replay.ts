// Replay a sequence of real Genie frames through Brain's live decision path
// (er2 model mode, shoulder rig, the real 2500 ms budget) and record each tick.
// Run in each Brain checkout (old and new) with vite-node; needs the repo .env.
//   vite-node -c vitest.config.ts scripts/ab-replay.ts <framesDir> <label> <out.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { Er2Perception } from "../server/perception/er2.js";
import { loadPolicy, withDecision, withRig } from "../server/policy.js";
import { TickHandler } from "../server/tick.js";

process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"));
const [dir, label, out] = process.argv.slice(2);
const policy = withDecision(withRig(loadPolicy("v1"), "shoulder"), "model");
const adapter = new Er2Perception(
  new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, apiVersion: "v1beta" }),
  "gemini-robotics-er-2-preview",
  undefined,
  policy.navigation.shoulder.anchor,
);
const task = { targetLabel: "exit", instruction: "Walk to the exit at the far end of the hallway." };
const handler = new TickHandler({ adapter, policy, taskFor: () => task });
const EP = "ep_01JDPG00000000000000000077";
const frames = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
const rows = [];
for (const [seq, f] of frames.entries()) {
  const frameNo = Number(f.replace(/\D/g, ""));
  const b64 = readFileSync(join(dir, f)).toString("base64");
  const res = await handler.handle({
    episodeId: EP, seq, t: Math.round((frameNo / 24) * 1000), driver: "brain",
    frame: { mime: "image/jpeg", width: 640, height: 360, b64 }, frameDiff: 0.05, recentHaunts: [],
  });
  let proposed = "";
  try { proposed = JSON.parse(adapter.lastRaw).intent ?? ""; } catch {}
  rows.push({
    frame: frameNo, proposed, key: res.action.key, source: res.decision?.source ?? "-",
    next: (res.decision as any)?.next ?? "", mode: res.mode, rationale: res.rationale,
    perceptionMs: res.perception.latencyMs, error: res.perception.error ?? "",
  });
  console.log(`${label} f${String(frameNo).padStart(4)} proposed=${proposed.padEnd(10)} -> ${res.action.key.padEnd(10)} ${String(res.decision?.source ?? "-").padEnd(8)} ${res.perception.latencyMs}ms ${res.perception.error ?? ""} | ${res.rationale}`);
}
writeFileSync(resolve(out), JSON.stringify({ label, rows }, null, 2));

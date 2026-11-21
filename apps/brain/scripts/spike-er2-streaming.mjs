// Spike: is Gemini Robotics-ER 2's streaming (Live API) model faster per decision
// than the request/response model Brain uses today? Same frames, same short
// decision prompt. Paid Gemini calls only (no Genie). Never prints the key.
//
//   node scripts/spike-er2-streaming.mjs <dir with .jpg frames>
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GoogleGenAI, Modality } from "@google/genai";

process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
const key = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: key, apiVersion: "v1beta" });
const dir = process.argv[2];
const frames = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort().slice(0, 6);
const PROMPT =
  "Third-person game frame. The player is a sage-green robot with an orange backpack. Goal: the exit. " +
  'Reply with ONLY compact JSON: {"intent": one of walk|step_left|step_right|turn_left|turn_right|hold|back_up, "reason": "<=60 chars"}.';
const safe = (e) => String(e?.message ?? e).replaceAll(key, "[redacted]").slice(0, 200);
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

// A) request/response, as Brain does today
const rr = [];
for (const f of frames) {
  const data = readFileSync(join(dir, f)).toString("base64");
  const t0 = performance.now();
  try {
    const r = await ai.models.generateContent({
      model: "gemini-robotics-er-2-preview",
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data } }, { text: PROMPT }] }],
      config: { temperature: 0, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 200 },
    });
    rr.push(Math.round(performance.now() - t0));
    console.log(`request/response ${f}: ${rr.at(-1)} ms  ${(r.text ?? "").replace(/\s+/g, " ").slice(0, 90)}`);
  } catch (e) {
    console.log(`request/response ${f}: ERROR ${safe(e)}`);
  }
}

// B) streaming model over one Live session (connection set up once)
const st = [];
let connectMs = null;
try {
  let resolveTurn;
  let text = "";
  const t0 = performance.now();
  const session = await ai.live.connect({
    model: "gemini-robotics-er-2-streaming-preview",
    config: { responseModalities: [Modality.TEXT], temperature: 0 },
    callbacks: {
      onmessage: (m) => {
        for (const p of m.serverContent?.modelTurn?.parts ?? []) if (p.text) text += p.text;
        if (m.serverContent?.turnComplete && resolveTurn) resolveTurn();
      },
      onerror: (e) => console.log("live error:", safe(e)),
      onclose: () => {},
    },
  });
  connectMs = Math.round(performance.now() - t0);
  console.log(`streaming: connected in ${connectMs} ms`);
  for (const f of frames) {
    const data = readFileSync(join(dir, f)).toString("base64");
    text = "";
    const done = new Promise((r) => (resolveTurn = r));
    const s0 = performance.now();
    session.sendClientContent({ turns: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data } }, { text: PROMPT }] }], turnComplete: true });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("no turnComplete in 15 s")), 15000));
    try {
      await Promise.race([done, timeout]);
      st.push(Math.round(performance.now() - s0));
      console.log(`streaming ${f}: ${st.at(-1)} ms  ${text.replace(/\s+/g, " ").slice(0, 90)}`);
    } catch (e) {
      console.log(`streaming ${f}: ${safe(e)}`);
    }
  }
  session.close();
} catch (e) {
  console.log("streaming: connect failed:", safe(e));
}

const fmt = (xs) => (xs.length ? `n=${xs.length} p50 ${pct(xs, 50)} ms, max ${Math.max(...xs)} ms` : "no successful calls");
console.log(`\nSUMMARY request/response: ${fmt(rr)}`);
console.log(`SUMMARY streaming: connect ${connectMs ?? "-"} ms, per decision ${fmt(st)}`);

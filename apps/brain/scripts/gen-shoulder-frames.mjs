// Generate Brain's synthetic over-the-shoulder POV frames with a Gemini image
// model, from World's robot-v1 turnaround and venue hallway. These are
// stand-ins until World supplies real Genie frames in the same POV.
//
//   node scripts/gen-shoulder-frames.mjs [scenario ...]
//
// Writes fixtures/media/fixture-zero/shoulder/<scenario>.png (full size);
// resize to 640×360 JPEG separately. Needs GEMINI_API_KEY in the repo's .env.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
process.loadEnvFile(join(repo, ".env"));
const model = process.env.PG_MODEL_IMAGE || "gemini-3-pro-image";
const out = join(repo, "fixtures/media/fixture-zero/shoulder/raw");
mkdirSync(out, { recursive: true });

const ref = (p, mimeType) => ({ inlineData: { mimeType, data: readFileSync(join(repo, p)).toString("base64") } });
const refs = [ref("apps/world/robot-v1/turnaround.webp", "image/webp"), ref("apps/world/robot-v1/hallway.webp", "image/webp")];

const CAMERA = [
  "Render one frame from a third-person video game using the robot from the first reference image (same design: scuffed sage-green shell, rounded box head, burnt-orange backpack with two dark straps, thin jointed legs, short black flashlight with a brass rim in its RIGHT hand)",
  "inside the dark venue hallway from the second reference image (wood floor, pendant lights dim after closing, a lit EXIT sign over a doorway at the far end).",
  "Camera: a tight over-the-shoulder shot from close behind and slightly above the robot's right shoulder. The robot is large and occupies the left third of the frame, seen from behind and slightly to its right: its back, backpack, right arm and flashlight are visible. Its head is near the vertical middle of the frame and the frame cuts the robot off around its knees, so its feet are below the bottom edge.",
  "The open walkway runs straight ahead from the bottom centre of the frame toward the vanishing point near the centre; the horizon is about 40% down from the top. The flashlight beam lights the floor ahead.",
  "Photoreal game render, 16:9, no text, no UI, no captions, no ghosts, no people.",
].join(" ");

const SCENARIOS = {
  "clear-route": "The walkway ahead is completely clear. The EXIT doorway is far ahead, slightly right of centre.",
  "chair-next-step": "A single bright yellow wooden cafe chair stands on all four legs on the floor directly in front of the robot, one short step ahead, at the bottom centre of the frame, blocking its next footstep. Open floor is visible to the right of the chair. The EXIT doorway is far ahead.",
  "chair-ahead-right-open": "A single bright yellow wooden cafe chair stands on the walkway several strides ahead, slightly left of centre, with clear open floor to its right. The EXIT doorway is far ahead, slightly right of centre.",
  "foil-crossing": "A long strip of crinkled reflective silver foil is unfurling across the floor directly in front of the robot, lying across its next footstep at the bottom centre of the frame, catching the flashlight. The EXIT doorway is far ahead.",
  "foil-beside": "A strip of crinkled silver foil rests on top of a bar stool beside the right-hand wall, its loose end lifting slightly, well away from the walkway. The walkway ahead of the robot is clear. The EXIT doorway is far ahead.",
  "absent": "Nothing unusual is in the hallway; the walkway ahead is completely clear. The robot has walked a little further, so the EXIT doorway is somewhat closer, ahead and slightly right of centre.",
  "stumbling": "The robot is visibly slipping and tipping sideways to the left, arms flung out, mid-stumble, flashlight beam swinging. The walkway ahead is clear. The EXIT doorway is far ahead.",
  "at-exit": "The robot has reached the far end: the lit EXIT doorway is immediately in front of it, filling the centre of the frame, its threshold on the floor right at the bottom of the frame just ahead of the robot.",
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: "v1beta" });
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
for (const name of wanted) {
  const t0 = Date.now();
  try {
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [...refs, { text: `${CAMERA}\n\nScene: ${SCENARIOS[name]}` }] }],
      config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
    });
    const img = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!img) throw new Error(`no image returned (finish ${res.candidates?.[0]?.finishReason})`);
    const ext = img.mimeType === "image/jpeg" ? "jpg" : "png";
    writeFileSync(join(out, `${name}.${ext}`), Buffer.from(img.data, "base64"));
    console.log(`${name}: ${Date.now() - t0} ms -> raw/${name}.${ext}`);
  } catch (e) {
    console.log(`${name}: FAILED ${String(e.message).replaceAll(process.env.GEMINI_API_KEY, "[redacted]").slice(0, 200)}`);
  }
}

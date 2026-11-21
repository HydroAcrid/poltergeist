// Prompt for the Gemini API key with hidden input and store it in the repo's
// git-ignored .env as GEMINI_API_KEY (also sets PG_LANE=brain). The key is
// never printed. Then checks that the key can see the perception model.
//
//   pnpm --dir apps/brain set-key
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
const model = process.env.PG_MODEL_PERCEPTION || "gemini-robotics-er-2-preview";

function askHidden(question) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      done(answer.trim());
    });
    muted = true;
  });
}

function upsert(lines, key, value) {
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

const key = await askHidden("Paste your Gemini API key (input hidden), then press Enter: ");
if (!key) {
  console.error("No key entered; nothing changed.");
  process.exit(1);
}

const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/).filter((l, i, a) => l || i < a.length - 1) : [];
upsert(lines, "GEMINI_API_KEY", key);
if (!lines.some((l) => l.startsWith("PG_LANE="))) upsert(lines, "PG_LANE", "brain");
writeFileSync(envPath, lines.join("\n") + "\n", { mode: 0o600 });
console.log(`Saved GEMINI_API_KEY to ${envPath} (git-ignored).`);

try {
  const ai = new GoogleGenAI({ apiKey: key, apiVersion: "v1beta" });
  const info = await ai.models.get({ model });
  console.log(`Key works: ${info.name ?? model} is reachable.`);
} catch (error) {
  const msg = String(error?.message ?? error).replaceAll(key, "[redacted]");
  console.error(`Saved, but the check against ${model} failed: ${msg.slice(0, 300)}`);
  process.exit(2);
}

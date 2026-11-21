// Two Gemini keys for Crowd, used safely: the second takes over when the first is rate-limited or
// failing, a per-minute cap protects the bill, and a key never appears in logs, state or output.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { GeminiModeration } from "../server/moderation/gemini.js";
import { loadCrowdGeminiKeys } from "../server/moderation/keys.js";

const KEY_A = "AIzaFAKE-key-A-0000000000000000000";
const KEY_B = "AIzaFAKE-key-B-1111111111111111111";
const ok = () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ decision: "accept", text: "Fog rolls down the hallway", tags: ["visibility"] }) }] } }] });
const keyOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)["x-goog-api-key"];

describe("two keys with failover", () => {
  it("uses the first key, switches to the second on a rate limit, and rests the first for a minute", async () => {
    let t = 0;
    const request = vi.fn<typeof fetch>(async (_u, init) =>
      ((init!.headers as Record<string, string>)["x-goog-api-key"] === KEY_A ? new Response("", { status: 429 }) : ok()));
    const m = new GeminiModeration([KEY_A, KEY_B], "gemini-4-hydrogen", request, undefined, { now: () => t });
    expect((await m.moderate("fog lol")).safe).toBe(true);
    expect(request.mock.calls.map(keyOf)).toEqual([KEY_A, KEY_B]);
    request.mockClear();
    await m.moderate("more fog");
    expect(request.mock.calls.map(keyOf)).toEqual([KEY_B]); // A is resting
    t += 61_000;
    request.mockClear();
    await m.moderate("even more fog");
    expect(request.mock.calls.map(keyOf)[0]).toBe(KEY_A); // A is back after its rest
  });

  it("fails over on server errors and bad keys too, but not on a normal answer", async () => {
    for (const status of [401, 403, 500, 503]) {
      const request = vi.fn<typeof fetch>(async (_u, init) =>
        ((init!.headers as Record<string, string>)["x-goog-api-key"] === KEY_A ? new Response("", { status }) : ok()));
      const m = new GeminiModeration([KEY_A, KEY_B], "gemini-4-hydrogen", request);
      expect((await m.moderate("fog lol")).safe).toBe(true);
    }
    const one = vi.fn<typeof fetch>(async () => ok());
    await new GeminiModeration([KEY_A, KEY_B], "gemini-4-hydrogen", one).moderate("fog lol");
    expect(one).toHaveBeenCalledOnce();
  });

  it("when every key fails, the idea is held back (never approved) and logs never contain a key", async () => {
    const faults: string[] = [];
    const request = vi.fn<typeof fetch>(async () => new Response(`bad key ${KEY_A}`, { status: 429 }));
    const m = new GeminiModeration([KEY_A, KEY_B], "gemini-4-hydrogen", request, (f) => faults.push(f));
    const r = await m.moderate("fog lol");
    expect(r.safe).toBe(false);
    expect(faults.length).toBeGreaterThan(0);
    expect(faults.join(" ")).not.toMatch(/AIza/);
    expect(JSON.stringify(r)).not.toMatch(/AIza/);
  });

  it("a network error that echoes the key never reaches the log", async () => {
    const faults: string[] = [];
    const request = vi.fn<typeof fetch>(async () => { throw new Error(`connect failed for ${KEY_A}`); });
    await new GeminiModeration([KEY_A], "gemini-4-hydrogen", request, (f) => faults.push(f)).moderate("fog lol");
    expect(faults.join(" ")).not.toMatch(/AIza/);
  });

  it("caps model calls per minute; over the cap the idea is held back without calling Gemini", async () => {
    let t = 0;
    const request = vi.fn<typeof fetch>(async () => ok());
    const m = new GeminiModeration([KEY_A, KEY_B], "gemini-4-hydrogen", request, undefined, { now: () => t, maxPerMinute: 2 });
    await m.moderate("fog one");
    await m.moderate("fog two");
    expect((await m.moderate("fog three")).safe).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    t += 60_001;
    expect((await m.moderate("fog four")).safe).toBe(true);
  });

  it("the adapter never shows its keys when printed or serialized", () => {
    const m = new GeminiModeration([KEY_A, KEY_B], "gemini-4-hydrogen");
    expect(JSON.stringify(m)).not.toMatch(/AIza/);
    expect(inspect(m, { depth: 5, showHidden: true })).not.toMatch(/AIza/);
    expect(String(m)).not.toMatch(/AIza/);
  });
});

describe("loading Crowd's keys", () => {
  const privateFile = (body: string, mode = 0o600) => {
    const dir = mkdtempSync(join(tmpdir(), "pg-keys-"));
    const f = join(dir, "crowd.env");
    writeFileSync(f, body);
    chmodSync(f, mode);
    return f;
  };

  it("reads both Crowd keys from the private file without putting them into process.env", () => {
    const file = privateFile(`# Crowd's Gemini keys\nPG_CROWD_GEMINI_KEY=${KEY_A}\nPG_CROWD_GEMINI_KEY_2="${KEY_B}"\n`);
    const { keys, source } = loadCrowdGeminiKeys({ PG_CROWD_ENV_FILE: file });
    expect(keys).toEqual([KEY_A, KEY_B]);
    expect(source).toBe("private file");
    expect(JSON.stringify(process.env)).not.toContain(KEY_A);
  });

  it("refuses a private file other people on the computer can read", () => {
    const logs: string[] = [];
    const file = privateFile(`PG_CROWD_GEMINI_KEY=${KEY_A}\n`, 0o644);
    const { keys } = loadCrowdGeminiKeys({ PG_CROWD_ENV_FILE: file }, (m) => logs.push(m));
    expect(keys).toEqual([]);
    expect(logs.join(" ")).toMatch(/chmod 600/);
    expect(logs.join(" ")).not.toMatch(/AIza/);
  });

  it("environment variables work too; World's shared GEMINI_API_KEY is only a last resort", () => {
    expect(loadCrowdGeminiKeys({ PG_CROWD_ENV_FILE: "/nope", PG_CROWD_GEMINI_KEY: KEY_A, PG_CROWD_GEMINI_KEY_2: KEY_B, GEMINI_API_KEY: "shared" }).keys).toEqual([KEY_A, KEY_B]);
    expect(loadCrowdGeminiKeys({ PG_CROWD_ENV_FILE: "/nope", GEMINI_API_KEY: "shared" })).toMatchObject({ keys: ["shared"], source: "GEMINI_API_KEY" });
    expect(loadCrowdGeminiKeys({ PG_CROWD_ENV_FILE: "/nope" }).keys).toEqual([]);
  });

  it("ignores blanks and duplicates", () => {
    expect(loadCrowdGeminiKeys({ PG_CROWD_ENV_FILE: "/nope", PG_CROWD_GEMINI_KEY: ` ${KEY_A} `, PG_CROWD_GEMINI_KEY_2: KEY_A }).keys).toEqual([KEY_A]);
    expect(loadCrowdGeminiKeys({ PG_CROWD_ENV_FILE: "/nope", PG_CROWD_GEMINI_KEY: "", PG_CROWD_GEMINI_KEY_2: "  " }).keys).toEqual([]);
  });
});

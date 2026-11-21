// Gemini-powered show conductor (`withAgent` adapter for server/conductor.ts).
// Ranks rule-feasible, already-moderated audience ideas against World's live scene within a tight
// latency budget, using the same #private key ring, failover, per-minute cap and key redaction as
// GeminiModeration. Raw crowd text and device IDs never enter this module.
import { z } from "zod";
import type { HauntTag } from "@poltergeist/contracts/common.js";
import { POLICY, type RecentHaunt, type SceneObservation } from "./conductor.js";
import { redact } from "./moderation/keys.js";
import { blockedReason, normalizeInput } from "./moderation/rules.js";

export interface ConductorCandidateSummary {
  hauntId: string;
  text: string;
  tags: HauntTag[];
  family: string;
  impact?: "subtle" | "clear" | "striking";
}

export interface ConductorRankContext {
  candidates: ConductorCandidateSummary[];
  scene?: SceneObservation;
  recent: Pick<RecentHaunt, "hauntId" | "kind" | "family" | "seen">[];
}

export interface ConductorAgent {
  rank(ctx: ConductorRankContext): Promise<{ hauntId: string; reason: string }[]>;
}

export interface ConductorAgentOptions {
  now?: () => number;
  maxPerMinute?: number;
  restMs?: number;
  timeoutMs?: number;
}

const FAILOVER = new Set([401, 403, 429, 500, 502, 503, 504]);

const rankedSchema = z.object({
  ranked: z
    .array(
      z.object({
        hauntId: z.string().min(1).max(64),
        reason: z.string().transform(normalizeInput).pipe(z.string().max(60)),
      }),
    )
    .max(12),
});

const outputSchema = {
  type: "object",
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hauntId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["hauntId", "reason"],
      },
    },
  },
  required: ["ranked"],
};

const systemPrompt = [
  "You are the live show conductor for Poltergeist, a third-person hallway game where audience hauntings challenge a flashlight robot walking to an exit.",
  "Every candidate below has ALREADY passed safety moderation and hard camera/timing rules.",
  "Rank the candidates from best to worst for this exact hallway moment: favor visual variety against recent hauntings, clear readability in the flashlight beam, and dramatic pacing.",
  "For your top pick, supply a concise, family-safe public reason of at most 60 characters that spectators can verify against the shot (no quotes, no markup, no player names).",
].join(" ");

export function isDisplaySafeReason(reason: string): boolean {
  const cleaned = normalizeInput(reason);
  return cleaned.length >= 1 && cleaned.length <= 60 && cleaned === reason && !blockedReason(cleaned);
}

export class GeminiConductorAgent implements ConductorAgent {
  readonly model: string;
  readonly #keys: string[];
  readonly #restUntil: number[];
  readonly #calls: number[] = [];
  readonly #now: () => number;
  readonly #maxPerMinute: number;
  readonly #restMs: number;
  readonly #timeoutMs: number;

  constructor(
    keys: string | string[],
    model = "gemini-4-hydrogen",
    private readonly request: typeof fetch = fetch,
    private readonly report?: (fault: string) => void,
    opts: ConductorAgentOptions = {},
  ) {
    this.model = model;
    this.#keys = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    this.#restUntil = this.#keys.map(() => 0);
    this.#now = opts.now ?? Date.now;
    this.#maxPerMinute = opts.maxPerMinute ?? 60;
    this.#restMs = opts.restMs ?? 60_000;
    this.#timeoutMs = opts.timeoutMs ?? POLICY.agentBudgetMs;
  }

  private fault(msg: string) {
    this.report?.(redact(msg, this.#keys));
  }

  private takeBudget(): boolean {
    const t = this.#now();
    while (this.#calls.length && this.#calls[0]! <= t - 60_000) this.#calls.shift();
    if (this.#calls.length >= this.#maxPerMinute) return false;
    this.#calls.push(t);
    return true;
  }

  private keyOrder(): number[] {
    const t = this.#now();
    const idx = this.#keys.map((_, i) => i);
    return [...idx.filter((i) => this.#restUntil[i]! <= t), ...idx.filter((i) => this.#restUntil[i]! > t)];
  }

  async rank(ctx: ConductorRankContext): Promise<{ hauntId: string; reason: string }[]> {
    if (!this.#keys.length || ctx.candidates.length < 2) return [];
    if (!this.takeBudget()) {
      this.fault("Gemini conductor over its per-minute cap; keeping deterministic pick");
      return [];
    }
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(this.model) +
      ":generateContent";
    const sceneSummary = ctx.scene
      ? {
          robotProgress: ctx.scene.robotProgress ?? null,
          timeRemainingMs: ctx.scene.timeRemainingMs,
          obstaclesInBeam: ctx.scene.obstacles.filter((o) => o.inBeam).map((o) => o.label),
        }
      : null;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify({
                scene: sceneSummary,
                recentFamilies: ctx.recent.slice(-3).map((r) => r.family ?? r.kind),
                candidates: ctx.candidates,
              }),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 256,
        ...(this.model === "gemini-4-hydrogen" ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
        responseMimeType: "application/json",
        responseJsonSchema: outputSchema,
      },
    });

    try {
      let response: Response | undefined;
      for (const i of this.keyOrder()) {
        const r = await this.request(url, {
          method: "POST",
          signal: AbortSignal.timeout(this.#timeoutMs),
          headers: { "content-type": "application/json", "x-goog-api-key": this.#keys[i]! },
          body,
        });
        if (r.ok || !FAILOVER.has(r.status)) {
          response = r;
          break;
        }
        this.#restUntil[i] = this.#now() + this.#restMs;
        this.fault(`Gemini conductor HTTP ${r.status} on key ${i + 1} of ${this.#keys.length}`);
        if (!r.bodyUsed) await r.body?.cancel();
      }
      if (!response || !response.ok) {
        if (response) {
          this.fault("Gemini conductor HTTP " + response.status);
          if (!response.bodyUsed) await response.body?.cancel();
        }
        return [];
      }
      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts;
      const raw = Array.isArray(parts)
        ? parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("")
        : "";
      return rankedSchema.parse(JSON.parse(raw)).ranked;
    } catch (error) {
      this.fault("Gemini conductor fallback (" + (error instanceof Error ? error.name : "unknown") + ")");
      return [];
    }
  }
}

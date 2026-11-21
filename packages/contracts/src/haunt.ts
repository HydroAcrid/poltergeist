// C07 Haunt, HauntPublic, HauntDispatch (crowd → bus `haunt.public` / `haunt.dispatch`, HTTP). Owner: crowd.
// Also the crowd HTTP shapes from C17 (`/api/crowd/haunt`, `/presets`, `/state`).
import { z } from "zod";
import { EpochMs, HauntTag, Id, Ms } from "./common.js";

export const VERSION = "1.4.0"; // 1.1.0: CrowdState.roundEndsAt · 1.2.0: CrowdState.you, client displayName ignored · 1.3.0: CrowdState.hallway · 1.4.0: Preset.group

export const HauntStatus = z.enum(["submitted", "rejected", "approved", "queued", "dispatched", "injected", "failed"]);
export type HauntStatus = z.infer<typeof HauntStatus>;

/** Statuses that require a safe moderation result. */
const SAFE_STATUSES: ReadonlySet<HauntStatus> = new Set(["approved", "queued", "dispatched", "injected", "failed"]);

export const Moderated = z
  .object({
    safe: z.boolean(),
    text: z.string().max(60), // physical world event, present tense; "" when rejected
    tags: z.array(HauntTag).max(3),
    reason: z.string().max(80).optional(), // private: author and /operator only
    model: z.string().min(1), // "rules-only", "preset", "seed" or the model id
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.safe && (m.text.length === 0 || m.tags.length < 1)) {
      ctx.addIssue({ code: "custom", message: "safe moderation needs text and 1–3 tags" });
    }
    if (!m.safe && m.text.length > 0) {
      ctx.addIssue({ code: "custom", message: "rejected moderation must not carry display text" });
    }
  });
export type Moderated = z.infer<typeof Moderated>;

const hauntFields = {
  hauntId: Id,
  deviceId: z.string().min(1).max(64), // anonymous cookie id; never leaves crowd except to /operator
  displayName: z.string().min(1).max(16).optional(), // system-assigned ghost name (never client-supplied)
  raw: z.string().min(1).max(80), // NEVER rendered on /stage or /overlay
  preset: z.string().min(1).max(40).optional(),
  status: HauntStatus,
  moderated: Moderated.optional(),
  votes: z.number().int().nonnegative(),
  seeded: z.boolean(),
  episodeId: Id.optional(),
  injectedT: Ms.optional(),
  createdAt: EpochMs,
};

type StatusShape = { status: HauntStatus; moderated?: Moderated | undefined; episodeId?: string | undefined; injectedT?: number | undefined };

function statusRules(h: StatusShape, ctx: z.RefinementCtx) {
  if (SAFE_STATUSES.has(h.status) && h.moderated?.safe !== true) {
    ctx.addIssue({ code: "custom", path: ["moderated"], message: `status ${h.status} needs moderated.safe = true` });
  }
  if (h.status === "rejected" && h.moderated?.safe !== false) {
    ctx.addIssue({ code: "custom", path: ["moderated"], message: "status rejected needs moderated.safe = false" });
  }
  if (h.status === "submitted" && h.moderated !== undefined) {
    ctx.addIssue({ code: "custom", path: ["moderated"], message: "status submitted has no moderation yet" });
  }
  if ((h.status === "dispatched" || h.status === "injected" || h.status === "failed") && !h.episodeId) {
    ctx.addIssue({ code: "custom", path: ["episodeId"], message: `status ${h.status} needs episodeId` });
  }
  if (h.status === "injected" && h.injectedT === undefined) {
    ctx.addIssue({ code: "custom", path: ["injectedT"], message: "status injected needs injectedT" });
  }
}

const HauntObject = z.object(hauntFields).strict();

export const Haunt = HauntObject.superRefine(statusRules);
export type Haunt = z.infer<typeof Haunt>;

/** Haunt without `raw` and `deviceId`. Strict, so a payload that leaks either key is rejected. */
export const HauntPublic = HauntObject.omit({ raw: true, deviceId: true }).strict().superRefine(statusRules);
export type HauntPublic = z.infer<typeof HauntPublic>;

export const HauntDispatch = z
  .object({
    hauntId: Id,
    episodeId: Id,
    text: z.string().min(1).max(60), // = moderated.text
    tags: z.array(HauntTag).min(1).max(3),
  })
  .strict();
export type HauntDispatch = z.infer<typeof HauntDispatch>;

// ---- C17 crowd HTTP shapes ----

export const Preset = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    label: z.string().min(1).max(28), // chip text
    text: z.string().min(1).max(60), // pre-approved world event
    tags: z.array(HauntTag).min(1).max(3),
    group: z.string().min(1).max(24).optional(), // heading on the "More ideas" page
  })
  .strict();
export type Preset = z.infer<typeof Preset>;

/** `POST /api/crowd/haunt` body. Unknown keys (a client-sent deviceId or displayName) are stripped: names are assigned. */
export const HauntSubmitRequest = z
  .object({
    text: z.string().trim().min(1).max(80).optional(),
    preset: z.string().min(1).max(40).optional(),
  })
  .refine((r) => (r.text === undefined) !== (r.preset === undefined), "send exactly one of text or preset");
export type HauntSubmitRequest = z.infer<typeof HauntSubmitRequest>;

export const HauntSubmitResponse = z.object({ hauntId: Id, status: HauntStatus }).strict();
export type HauntSubmitResponse = z.infer<typeof HauntSubmitResponse>;

/** `GET /api/crowd/state`: `mine` is derived from the caller's cookie; `queue` is eligible, display-safe items in dispatch order. */
export const CrowdState = z
  .object({
    episodeActive: z.boolean(),
    round: z.number().int().nonnegative().optional(),
    nextRoundAt: EpochMs.optional(), // only between rounds
    roundEndsAt: EpochMs.optional(), // only during a round: Episode.startedAt + maxDurationMs
    you: z.object({ ghostName: z.string().min(1).max(16) }).strict().optional(), // the caller's assigned ghost name
    mine: z.array(HauntPublic),
    queue: z.array(HauntPublic),
    hallway: z.array(HauntPublic).max(8).optional(), // this round's sent ideas, newest first, display-safe
  })
  .strict();
export type CrowdState = z.infer<typeof CrowdState>;

export const ErrorCode = z.enum(["BUSY", "CAP_SESSIONS", "CAP_USD", "GENIE_UNAVAILABLE", "RATE_LIMITED", "REJECTED", "INVALID", "UNAUTHORIZED"]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({ error: z.object({ code: ErrorCode, message: z.string() }) });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

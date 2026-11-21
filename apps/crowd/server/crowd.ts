// Crowd core: submissions, moderation, the FIFO queue and the haunting scheduler.
// Pure logic over a Bus and an injectable clock; HTTP lives in routes.ts.
import type { Id } from "@poltergeist/contracts/common.js";
import type { Episode, EpisodeEnded } from "@poltergeist/contracts/episode.js";
import { HauntDispatch, HauntPublic, type CrowdState, type Haunt, type HauntSubmitRequest, type Preset } from "@poltergeist/contracts/haunt.js";
import type { HauntInjected } from "@poltergeist/contracts/haunt-injected.js";
import type { Bus, Envelope } from "@poltergeist/contracts/hub-types.js";
import type { OperatorCommand } from "@poltergeist/contracts/operator.js";
import { newId } from "./ids.js";
import type { ModerationAdapter } from "./moderation/types.js";

export interface CrowdConfig {
  rateMs: number; // min gap between submissions per device
  dailyMax: number; // submissions per device per day
  firstDispatchMs: number; // first slot at t ≥ this
  intervalMs: number; // PG_HAUNT_INTERVAL_MS
  maxPerEpisode: number; // PG_HAUNT_MAX_PER_EPISODE
  seededFallback: boolean;
  roundEveryMs: number; // public rounds every 15 min (:00 :15 :30 :45)
}

export const DEFAULT_CONFIG: CrowdConfig = {
  rateMs: 20_000,
  dailyMax: 30,
  firstDispatchMs: 8_000,
  intervalMs: 12_000,
  maxPerEpisode: 6,
  seededFallback: true,
  roundEveryMs: 15 * 60_000,
};

export function configFromEnv(env: Record<string, string | undefined>): CrowdConfig {
  const num = (k: string, d: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v >= 0 && env[k] !== "" && env[k] !== undefined ? v : d;
  };
  return {
    ...DEFAULT_CONFIG,
    intervalMs: num("PG_HAUNT_INTERVAL_MS", DEFAULT_CONFIG.intervalMs),
    maxPerEpisode: num("PG_HAUNT_MAX_PER_EPISODE", DEFAULT_CONFIG.maxPerEpisode),
    rateMs: num("PG_HAUNT_RATE_MS", DEFAULT_CONFIG.rateMs),
    dailyMax: num("PG_HAUNT_DAILY_MAX", DEFAULT_CONFIG.dailyMax),
    seededFallback: env.PG_HAUNT_SEEDED_FALLBACK !== "0",
  };
}

export type SubmitResult =
  | { ok: true; hauntId: Id; status: "submitted" }
  | { ok: false; code: "RATE_LIMITED" | "INVALID"; message: string };

interface ActiveEpisode {
  episodeId: Id;
  startedAt: number;
  round?: number;
  dispatched: number;
  nextSlotT: number;
}

export interface CrowdDeps {
  bus: Bus;
  moderation: ModerationAdapter;
  presets: Preset[];
  seededPool: Haunt[];
  now?: () => number;
  config?: Partial<CrowdConfig>;
  log?: (msg: string, extra?: object) => void;
}

/** Display-safe copy. `forAuthor` keeps the private rejection reason. */
export function toPublic(h: Haunt, forAuthor = false): HauntPublic {
  const { raw: _raw, deviceId: _deviceId, ...rest } = h;
  if (rest.moderated && !forAuthor) {
    const { reason: _reason, ...m } = rest.moderated;
    return { ...rest, moderated: m };
  }
  return rest;
}

const fifo = (a: Haunt, b: Haunt) => a.createdAt - b.createdAt || (a.hauntId < b.hauntId ? -1 : a.hauntId > b.hauntId ? 1 : 0);

export class CrowdService {
  readonly config: CrowdConfig;
  finalsApprovalMode = false;

  private haunts = new Map<Id, Haunt>();
  private operatorApproved = new Set<Id>();
  private submissions = new Map<string, number[]>(); // deviceId → submit times
  private seenEnvelopes = new Set<string>();
  private pending = new Set<Promise<void>>();
  private seededCursor = 0;
  private active: ActiveEpisode | null = null;
  private lastRound: number | undefined;
  private unsubscribe: () => void;
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly presetsById: Map<string, Preset>;

  constructor(private deps: CrowdDeps) {
    this.now = deps.now ?? Date.now;
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
    this.presetsById = new Map(deps.presets.map((p) => [p.id, p]));
    this.unsubscribe = deps.bus.subscribe(["episode.started", "episode.ended", "haunt.injected", "operator.command"], (e) => this.onEvent(e));
  }

  // ---------- lifecycle ----------

  start(tickMs = 250): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe();
  }

  /** Resolves once every in-flight moderation call has finished (tests). */
  async whenIdle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  get presets(): Preset[] {
    return this.deps.presets;
  }

  // ---------- submissions ----------

  submit(deviceId: string, req: HauntSubmitRequest): SubmitResult {
    const now = this.now();
    const preset = req.preset !== undefined ? this.presetsById.get(req.preset) : undefined;
    if (req.preset !== undefined && !preset) return { ok: false, code: "INVALID", message: "That preset doesn't exist." };

    const limited = this.rateLimit(deviceId, now);
    if (limited) return { ok: false, code: "RATE_LIMITED", message: limited };

    const displayName = req.displayName ? this.deps.moderation.nickname(req.displayName) : undefined;
    const haunt: Haunt = {
      hauntId: newId("ht", now),
      deviceId,
      ...(displayName ? { displayName } : {}),
      raw: preset ? preset.label : req.text!,
      ...(preset ? { preset: preset.id } : {}),
      status: "submitted",
      votes: 0,
      seeded: false,
      createdAt: now,
    };
    this.haunts.set(haunt.hauntId, haunt);
    this.publishPublic(haunt);

    const job = this.moderate(haunt, preset).finally(() => this.pending.delete(job));
    this.pending.add(job);
    return { ok: true, hauntId: haunt.hauntId, status: "submitted" };
  }

  private rateLimit(deviceId: string, now: number): string | null {
    const dayStart = new Date(now).setHours(0, 0, 0, 0);
    const times = (this.submissions.get(deviceId) ?? []).filter((t) => t >= dayStart);
    const last = times[times.length - 1];
    if (last !== undefined && now - last < this.config.rateMs) {
      const wait = Math.ceil((this.config.rateMs - (now - last)) / 1000);
      return `One idea every ${Math.round(this.config.rateMs / 1000)} seconds. Try again in ${wait} seconds.`;
    }
    if (times.length >= this.config.dailyMax) {
      return `You've sent ${this.config.dailyMax} ideas today, the daily limit. Thanks for haunting!`;
    }
    times.push(now);
    this.submissions.set(deviceId, times);
    return null;
  }

  private async moderate(haunt: Haunt, preset: Preset | undefined): Promise<void> {
    let moderated: Haunt["moderated"];
    try {
      moderated = preset
        ? { safe: true, text: preset.text, tags: preset.tags, model: "preset" }
        : await this.deps.moderation.moderate(haunt.raw);
    } catch (err) {
      this.deps.log?.("moderation failed", { hauntId: haunt.hauntId, err: String(err) });
      moderated = { safe: false, text: "", tags: [], reason: "We couldn't check that one. Try again.", model: this.deps.moderation.name };
    }
    const current = this.haunts.get(haunt.hauntId);
    if (!current || current.status !== "submitted") return; // operator acted first
    if (!moderated.safe) {
      this.setStatus(current, "rejected", { moderated });
      return;
    }
    this.setStatus(current, "approved", { moderated });
    if (!this.finalsApprovalMode) this.setStatus(current, "queued");
  }

  // ---------- views ----------

  /** Eligible proposals in dispatch order: FIFO by createdAt, ties by hauntId. */
  eligible(): Haunt[] {
    return [...this.haunts.values()].filter((h) => h.status === "queued").sort(fifo);
  }

  state(deviceId: string): CrowdState {
    const mine = [...this.haunts.values()]
      .filter((h) => h.deviceId === deviceId)
      .sort((a, b) => fifo(b, a))
      .map((h) => toPublic(h, true));
    return {
      episodeActive: this.active !== null,
      ...(this.active?.round !== undefined || this.lastRound !== undefined ? { round: this.active?.round ?? this.lastRound } : {}),
      ...(this.active ? {} : { nextRoundAt: this.nextRoundAt() }),
      mine,
      queue: this.eligible().map((h) => toPublic(h)),
    };
  }

  /** Every haunt including raw text, newest first: operator only. */
  allHaunts(): Haunt[] {
    return [...this.haunts.values()].sort((a, b) => fifo(b, a));
  }

  private nextRoundAt(): number {
    const every = this.config.roundEveryMs;
    return Math.ceil((this.now() + 1) / every) * every;
  }

  // ---------- scheduler ----------

  tick(): void {
    const ep = this.active;
    if (!ep || ep.dispatched >= this.config.maxPerEpisode) return;
    const t = this.now() - ep.startedAt;
    if (t < ep.nextSlotT) return;

    const pick = this.eligible()[0] ?? (this.config.seededFallback ? this.takeSeeded() : undefined);
    if (!pick) return; // the slot stays open until something is eligible

    // Reserve before publishing, so a re-entrant tick can never send it twice.
    this.setStatus(pick, "dispatched", { episodeId: ep.episodeId });
    ep.dispatched++;
    ep.nextSlotT = Math.max(ep.nextSlotT, t) + this.config.intervalMs;
    const dispatch = HauntDispatch.parse({ hauntId: pick.hauntId, episodeId: ep.episodeId, text: pick.moderated!.text, tags: pick.moderated!.tags });
    this.deps.bus.publish("haunt.dispatch", "crowd", dispatch, ep.episodeId);
  }

  private takeSeeded(): Haunt | undefined {
    const pool = this.deps.seededPool;
    if (pool.length === 0) return undefined;
    const src = pool[this.seededCursor++ % pool.length]!;
    const now = this.now();
    const copy: Haunt = { ...src, hauntId: newId("ht", now), status: "queued", createdAt: now };
    this.haunts.set(copy.hauntId, copy);
    return copy;
  }

  private releaseSeeded(count: number): void {
    for (let i = 0; i < count; i++) {
      const h = this.takeSeeded();
      if (h) this.publishPublic(h);
    }
  }

  // ---------- bus ----------

  private onEvent(e: Envelope): void {
    if (this.seenEnvelopes.has(e.id)) return; // consumers are idempotent by envelope id
    this.seenEnvelopes.add(e.id);
    switch (e.type) {
      case "episode.started": {
        const ep = e.payload as Episode;
        this.active = { episodeId: ep.episodeId, startedAt: ep.startedAt, round: ep.round, dispatched: 0, nextSlotT: this.config.firstDispatchMs };
        if (ep.round !== undefined) this.lastRound = ep.round;
        break;
      }
      case "episode.ended": {
        const ended = e.payload as EpisodeEnded;
        if (this.active?.episodeId === ended.episodeId) this.active = null;
        break;
      }
      case "haunt.injected": {
        const inj = e.payload as HauntInjected;
        const h = this.haunts.get(inj.hauntId);
        if (!h || h.status !== "dispatched") return;
        if (inj.ok) this.setStatus(h, "injected", { injectedT: inj.t });
        else this.setStatus(h, "failed"); // never retried
        break;
      }
      case "operator.command":
        this.onOperator(e.payload as OperatorCommand);
        break;
    }
  }

  private onOperator(cmd: OperatorCommand): void {
    switch (cmd.cmd) {
      case "finals.approvalMode":
        this.finalsApprovalMode = cmd.on;
        if (!cmd.on) for (const h of this.haunts.values()) if (h.status === "approved") this.setStatus(h, "queued");
        break;
      case "haunt.approve": {
        const h = this.haunts.get(cmd.hauntId);
        if (h?.status === "approved") {
          this.operatorApproved.add(h.hauntId);
          this.setStatus(h, "queued");
        }
        break;
      }
      case "haunt.reject": {
        const h = this.haunts.get(cmd.hauntId);
        if (h && ["submitted", "approved", "queued"].includes(h.status)) {
          this.setStatus(h, "rejected", { moderated: { safe: false, text: "", tags: [], reason: "Not picked by the host this time.", model: "operator" } });
        }
        break;
      }
      case "haunt.releaseSeeded":
        this.releaseSeeded(cmd.count);
        break;
      default:
        break; // world/brain commands
    }
  }

  private setStatus(h: Haunt, status: Haunt["status"], patch: Partial<Haunt> = {}): void {
    Object.assign(h, patch, { status });
    this.publishPublic(h);
  }

  private publishPublic(h: Haunt): void {
    this.deps.bus.publish("haunt.public", "crowd", toPublic(h), h.episodeId);
  }
}

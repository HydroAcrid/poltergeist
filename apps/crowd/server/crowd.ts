// Crowd core: submissions, moderation, the FIFO queue and the haunting scheduler.
// Pure logic over a Bus and an injectable clock; HTTP lives in routes.ts.
import type { Id } from "@poltergeist/contracts/common.js";
import type { Episode, EpisodeEnded } from "@poltergeist/contracts/episode.js";
import { HauntDispatch, HauntPublic, type CrowdState, type Haunt, type HauntSubmitRequest, type Preset } from "@poltergeist/contracts/haunt.js";
import type { HauntInjected } from "@poltergeist/contracts/haunt-injected.js";
import type { Bus, Envelope } from "@poltergeist/contracts/hub-types.js";
import type { OperatorCommand } from "@poltergeist/contracts/operator.js";
import type { Scoreboard } from "@poltergeist/contracts/scoreboard.js";
import type { Verdict } from "@poltergeist/contracts/verdict.js";
import { GhostNames } from "./ghost-names.js";
import { conduct, kindOf, type Candidate, type Decision, type RecentHaunt, type SceneObservation } from "./conductor.js";
import { ruleVerdict, type RefInjected, type RefTick } from "./referee.js";
import { buildScoreboard } from "./scoreboard.js";
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
  endGraceMs: number; // past startedAt + maxDurationMs + this with no episode.ended → treat the round as interrupted
}

export const DEFAULT_CONFIG: CrowdConfig = {
  rateMs: 20_000,
  dailyMax: 30,
  firstDispatchMs: 8_000,
  intervalMs: 12_000,
  maxPerEpisode: 6,
  seededFallback: true,
  roundEveryMs: 15 * 60_000,
  endGraceMs: 5_000,
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
  endsAt: number;
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
  /** Latest scene for the conductor (World's rehearsal state today). Missing or stale → FIFO. */
  scene?: () => SceneObservation | undefined;
}

/** Display-safe copy. `forAuthor` keeps private moderation feedback. */
export function toPublic(h: Haunt, forAuthor = false): HauntPublic {
  const { raw: _raw, deviceId: _deviceId, ...rest } = h;
  if (rest.moderated && !forAuthor) {
    const { reason: _reason, suggestion: _suggestion, ...m } = rest.moderated;
    return { ...rest, moderated: m };
  }
  return rest;
}

const fifo = (a: Haunt, b: Haunt) => a.createdAt - b.createdAt || (a.hauntId < b.hauntId ? -1 : a.hauntId > b.hauntId ? 1 : 0);

export class CrowdService {
  readonly config: CrowdConfig;
  finalsApprovalMode = false;

  private haunts = new Map<Id, Haunt>();
  private names = new GhostNames();
  private hallwayIds: Id[] = []; // dispatched this round, oldest first
  private ticksByEpisode = new Map<Id, RefTick[]>(); // Brain's TickLog, for the referee
  private injectedLog: (RefInjected & { episodeId: Id })[] = [];
  private verdicts = new Map<Id, Verdict>(); // one per episode (final replaces provisional)
  private policyVersion = "v1";
  // Conductor: one reserved pick, stable until it's sent or becomes impossible.
  private reserved: { hauntId: Id; reason: string; mode: "conductor" | "fifo" } | null = null;
  private waitingReasons = new Map<Id, string>();
  private skips = new Map<Id, number>();
  private sentAt = new Map<Id, number>();
  // Waiting room: guest phones by device, last poll time. Projector and other polls never land here.
  private guests = new Map<string, number>();
  private board: Scoreboard | null = null;
  private operatorApproved = new Set<Id>();
  private submissions = new Map<string, { time: number; hauntId: Id; revised: boolean }[]>();
  private revisions = new Map<Id, Id>(); // rejected parent → its one resubmission
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
    this.unsubscribe = deps.bus.subscribe(["episode.started", "episode.ended", "haunt.injected", "operator.command", "tick"], (e) => this.onEvent(e));
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

    if (req.revisionOf !== undefined) {
      const parent = this.haunts.get(req.revisionOf);
      if (!req.text || preset || parent?.deviceId !== deviceId || parent.status !== "rejected") {
        return { ok: false, code: "INVALID", message: "Choose a rejected idea from My ideas to revise." };
      }
      const previous = this.revisions.get(parent.hauntId);
      if (previous) {
        if (this.haunts.get(previous)?.raw === req.text) return { ok: true, hauntId: previous, status: "submitted" };
        return { ok: false, code: "INVALID", message: "You already sent a revision of this idea. Check My ideas." };
      }
    }

    // One waiting idea each: a new idea replaces the author's waiting one, except their reserved
    // Up next, which stays put so the public pick never jumps.
    const waiting = [...this.haunts.values()].filter(
      (h) => h.deviceId === deviceId && !h.seeded && (h.status === "submitted" || h.status === "approved" || h.status === "queued"),
    );
    if (waiting.some((h) => h.hauntId === this.reserved?.hauntId)) {
      return { ok: false, code: "INVALID", message: "Your idea is up next. Send another once it goes in." };
    }

    const hauntId = newId("ht", now);
    const limited = this.rateLimit(deviceId, now, hauntId, req.revisionOf);
    if (limited) return { ok: false, code: "RATE_LIMITED", message: limited };

    const haunt: Haunt = {
      hauntId,
      deviceId,
      displayName: this.ghostName(deviceId),
      raw: preset ? preset.label : req.text!,
      ...(preset ? { preset: preset.id } : {}),
      status: "submitted",
      votes: 0,
      seeded: false,
      createdAt: now,
    };
    this.haunts.set(haunt.hauntId, haunt);
    if (req.revisionOf !== undefined) this.revisions.set(req.revisionOf, hauntId);
    this.publishPublic(haunt);
    for (const old of waiting) {
      this.setStatus(old, "withdrawn");
      this.waitingReasons.delete(old.hauntId);
    }

    const job = this.moderate(haunt, preset).finally(() => this.pending.delete(job));
    this.pending.add(job);
    return { ok: true, hauntId: haunt.hauntId, status: "submitted" };
  }

  private rateLimit(deviceId: string, now: number, hauntId: Id, revisionOf?: Id): string | null {
    const dayStart = new Date(now).setHours(0, 0, 0, 0);
    const times = (this.submissions.get(deviceId) ?? []).filter((entry) => entry.time >= dayStart);
    const last = times[times.length - 1];
    // A rejected original can be corrected immediately. Further revisions use the usual interval.
    const fastRevision = last && !last.revised && last.hauntId === revisionOf;
    if (last && !fastRevision && now - last.time < this.config.rateMs) {
      const wait = Math.ceil((this.config.rateMs - (now - last.time)) / 1000);
      return `One idea every ${Math.round(this.config.rateMs / 1000)} seconds. Try again in ${wait} seconds.`;
    }
    if (times.length >= this.config.dailyMax) {
      return `You've sent ${this.config.dailyMax} ideas today, the daily limit. Thanks for haunting!`;
    }
    times.push({ time: now, hauntId, revised: revisionOf !== undefined });
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

  /** A guest phone polled (the phone page marks its polls). */
  noteGuest(deviceId: string): void {
    this.guests.set(deviceId, this.now());
  }

  /** Guest phones seen in the last 30 s (`here`) and every guest phone that ever joined (`total`). */
  joined(): { here: number; total: number } {
    const since = this.now() - 30_000;
    let here = 0;
    for (const t of this.guests.values()) if (t >= since) here++;
    return { here, total: this.guests.size };
  }

  /** The device's assigned ghost name (stable, unique in the room). */
  ghostName(deviceId: string): string {
    return this.names.nameFor(deviceId);
  }

  // ---------- views ----------

  /** Eligible proposals in dispatch order: FIFO by createdAt, ties by hauntId. */
  eligible(): Haunt[] {
    return [...this.haunts.values()].filter((h) => h.status === "queued").sort(fifo);
  }

  state(deviceId: string, requestedPage?: number): CrowdState & {
    waiting?: { page: number; size: number; total: number; myPositions: Record<string, number> }
  } {
    this.expireStaleRound();
    const mine = [...this.haunts.values()]
      .filter((h) => h.deviceId === deviceId)
      .sort((a, b) => fifo(b, a))
      .map((h) => toPublic(h, true));
    let queue = this.orderedQueue(); // the conductor's reserved pick leads; Kevin's paging keeps it featured
    let waiting;
    if (requestedPage !== undefined) {
      const size = 15;
      const total = Math.max(0, queue.length - 1); // the head is featured on every page
      const page = Math.min(requestedPage, Math.max(0, Math.ceil(total / size) - 1));
      const start = 1 + page * size;
      const myPositions: Record<string, number> = {};
      for (const [index, h] of queue.entries()) {
        if (h.deviceId === deviceId) myPositions[h.hauntId] = index + 1;
      }
      waiting = { page, size, total, myPositions };
      queue = [...queue.slice(0, 1), ...queue.slice(start, start + size)];
    }
    return {
      ...(waiting ? { waiting } : {}),
      episodeActive: this.active !== null,
      ...(this.active?.round !== undefined || this.lastRound !== undefined ? { round: this.active?.round ?? this.lastRound } : {}),
      ...(this.active ? { roundEndsAt: this.active.endsAt } : { nextRoundAt: this.nextRoundAt() }),
      you: { ghostName: this.ghostName(deviceId) },
      mine,
      queue: queue.map((h) => toPublic(h)),
      slotsPerRound: this.config.maxPerEpisode,
      joined: this.joined().here,
      ...(this.reserved ? { upNext: { ...this.reserved } } : {}),
      ...(this.waitingReasons.size ? { holds: [...this.waitingReasons].map(([hauntId, reason]) => ({ hauntId, reason })) } : {}),
      hallway: this.hallwayIds.slice(-8).reverse().map((id) => toPublic(this.haunts.get(id)!)),
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

  /**
   * World can't yet guarantee episode.ended on every failure path, so a round that
   * runs past its deadline plus a grace period is treated as interrupted: no more
   * dispatches, and phones stop showing it as live. Queued ideas wait for the next round.
   */
  private expireStaleRound(): void {
    const ep = this.active;
    if (ep && this.now() >= ep.endsAt + this.config.endGraceMs) {
      this.deps.log?.("round passed its deadline without episode.ended; treating it as interrupted", { episodeId: ep.episodeId });
      this.active = null;
    }
  }

  tick(): void {
    this.expireStaleRound();
    this.reserve();
    const ep = this.active;
    if (!ep || ep.dispatched >= this.config.maxPerEpisode) return;
    const t = this.now() - ep.startedAt;
    if (t < ep.nextSlotT) return;

    // Re-check the reserved pick's hard rules right before sending; if it's now impossible,
    // release it (with its public reason) and pick again. The public pick changes only here.
    if (this.reserved) {
      const h = this.haunts.get(this.reserved.hauntId);
      const check = h ? this.decide([h]) : undefined;
      if (!h || h.status !== "queued" || (check && !check.pick)) {
        if (check?.waiting[0]) this.waitingReasons.set(this.reserved.hauntId, check.waiting[0].reason);
        this.reserved = null;
        this.reserve();
      }
    }
    const reservedHaunt = this.reserved ? this.haunts.get(this.reserved.hauntId) : undefined;
    const pick = reservedHaunt ?? (this.eligible().length === 0 && this.config.seededFallback ? this.takeSeeded() : undefined);
    if (!pick) return; // the slot stays open until something feasible is eligible
    this.reserved = null;
    this.waitingReasons.delete(pick.hauntId);
    this.sentAt.set(pick.hauntId, this.now());

    // Reserve before publishing, so a re-entrant tick can never send it twice.
    this.setStatus(pick, "dispatched", { episodeId: ep.episodeId });
    this.hallwayIds.push(pick.hauntId);
    ep.dispatched++;
    ep.nextSlotT = Math.max(ep.nextSlotT, t) + this.config.intervalMs;
    const dispatch = HauntDispatch.parse({ hauntId: pick.hauntId, episodeId: ep.episodeId, text: pick.moderated!.text, tags: pick.moderated!.tags });
    this.deps.bus.publish("haunt.dispatch", "crowd", dispatch, ep.episodeId);
  }

  /** Reserved pick first, then the rest in FIFO order. */
  private orderedQueue(): Haunt[] {
    const list = this.eligible();
    const id = this.reserved?.hauntId;
    const head = id ? list.find((h) => h.hauntId === id) : undefined;
    return head ? [head, ...list.filter((h) => h !== head)] : list;
  }

  private decide(list: Haunt[]): Decision {
    const scene = this.deps.scene?.();
    const round = new Set(this.hallwayIds);
    const picksBy = new Map<string, number>();
    for (const id of round) {
      const d = this.haunts.get(id)?.deviceId;
      if (d) picksBy.set(d, (picksBy.get(d) ?? 0) + 1);
    }
    const candidates: Candidate[] = list.map((h) => ({
      hauntId: h.hauntId,
      createdAt: h.createdAt,
      text: h.moderated?.text ?? "",
      tags: h.moderated?.tags ?? [],
      ...(h.preset ? { preset: h.preset } : {}),
      skips: this.skips.get(h.hauntId) ?? 0,
      authorPicksThisRound: picksBy.get(h.deviceId) ?? 0,
    }));
    const recent: RecentHaunt[] = this.hallwayIds.slice(-4).map((id) => {
      const h = this.haunts.get(id);
      return {
        hauntId: id,
        kind: kindOf({ preset: h?.preset, tags: h?.moderated?.tags ?? [], text: h?.moderated?.text ?? "" }),
        primaryTag: h?.moderated?.tags?.[0] ?? "other",
        sentAt: this.sentAt.get(id) ?? 0,
        seen: scene?.seenHauntIds.includes(id) ?? false,
      };
    });
    return conduct(candidates, scene, recent, this.now());
  }

  /** Keep exactly one reserved pick while ideas are eligible, and refresh the public waiting reasons. */
  private reserve(): void {
    const eligible = this.eligible();
    const ids = new Set(eligible.map((h) => h.hauntId));
    for (const id of [...this.waitingReasons.keys()]) if (!ids.has(id)) this.waitingReasons.delete(id);
    if (this.reserved && !ids.has(this.reserved.hauntId)) this.reserved = null;
    // A FIFO pick made before World's scene arrived is upgraded once a fresh scene exists.
    if (this.reserved?.mode === "fifo" && this.deps.scene?.()) this.reserved = null;
    const others = eligible.filter((h) => h.hauntId !== this.reserved?.hauntId);
    if (!others.length && this.reserved) return;
    const d = this.decide(others);
    for (const w of d.waiting) {
      if (d.mode === "conductor") this.waitingReasons.set(w.hauntId, w.reason);
      else this.waitingReasons.delete(w.hauntId);
    }
    // A feasible idea behind the reserved pick has no hold reason any more.
    if (d.pick) this.waitingReasons.delete(d.pick.hauntId);
    for (const w of d.waiting) if (w.code === "ranked_lower") this.waitingReasons.delete(w.hauntId);
    if (!this.reserved && d.pick) {
      this.reserved = { hauntId: d.pick.hauntId, reason: d.pick.reason, mode: d.mode };
      this.waitingReasons.delete(d.pick.hauntId);
      // Fair turns: anything feasible that was passed over gets closer to its guaranteed turn.
      for (const w of d.waiting) if (w.code === "ranked_lower") this.skips.set(w.hauntId, (this.skips.get(w.hauntId) ?? 0) + 1);
    }
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
        this.active = {
          episodeId: ep.episodeId,
          startedAt: ep.startedAt,
          endsAt: ep.startedAt + ep.maxDurationMs,
          round: ep.round,
          dispatched: 0,
          nextSlotT: this.config.firstDispatchMs,
        };
        if (ep.round !== undefined) this.lastRound = ep.round;
        this.hallwayIds = []; // a new round starts with an empty hallway
        if (ep.policyVersion) this.policyVersion = ep.policyVersion;
        break;
      }
      case "episode.ended": {
        const ended = e.payload as EpisodeEnded;
        if (this.active?.episodeId === ended.episodeId) this.active = null;
        this.referee(ended);
        break;
      }
      case "tick": {
        const k = e.payload as RefTick & { episodeId?: Id };
        if (!k?.episodeId || typeof k.t !== "number" || !k.perception) return;
        const list = this.ticksByEpisode.get(k.episodeId) ?? [];
        if (list.length < 2000) list.push({ seq: k.seq, t: k.t, perception: k.perception, action: k.action, mode: k.mode, ...(k.reaction ? { reaction: k.reaction } : {}) });
        this.ticksByEpisode.set(k.episodeId, list);
        break;
      }
      case "haunt.injected": {
        const inj = e.payload as HauntInjected;
        this.injectedLog.push({ hauntId: inj.hauntId, t: inj.t, ok: inj.ok, episodeId: inj.episodeId });
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

  /** Rule verdict for an ended episode (published within the same tick), then a scoreboard update. */
  private referee(ended: EpisodeEnded): void {
    try {
      const verdict = ruleVerdict(
        {
          episode: { episodeId: ended.episodeId },
          ended,
          ticks: this.ticksByEpisode.get(ended.episodeId) ?? [],
          injected: this.injectedLog.filter((i) => i.episodeId === ended.episodeId),
          haunts: [...this.haunts.values()].filter((h) => h.episodeId === ended.episodeId),
        },
        this.now(),
      );
      this.verdicts.set(ended.episodeId, verdict);
      this.deps.bus.publish("verdict.provisional", "crowd", verdict, ended.episodeId);
    } catch (err) {
      this.deps.log?.("referee failed", { episodeId: ended.episodeId, err: String(err) });
    }
    this.ticksByEpisode.delete(ended.episodeId);
    this.publishScoreboard();
  }

  private publishScoreboard(): void {
    this.board = buildScoreboard({
      haunts: [...this.haunts.values()],
      injected: this.injectedLog,
      verdicts: [...this.verdicts.values()],
      policyVersion: this.policyVersion,
      now: this.now(),
    });
    this.deps.bus.publish("scoreboard.updated", "crowd", this.board);
  }

  /** Current scoreboard (GET /api/crowd/scoreboard). */
  scoreboard(): Scoreboard {
    if (!this.board) this.publishScoreboard();
    return this.board!;
  }

  private setStatus(h: Haunt, status: Haunt["status"], patch: Partial<Haunt> = {}): void {
    Object.assign(h, patch, { status });
    this.publishPublic(h);
  }

  private publishPublic(h: Haunt): void {
    this.deps.bus.publish("haunt.public", "crowd", toPublic(h), h.episodeId);
  }
}

// Crowd's local stand-in for World, for tests and the dev hub only. World's
// real fake (apps/world/server/fake.ts) replaces it once the scaffold lands.
// It starts and ends episodes and answers every haunt.dispatch with
// haunt.injected { ok: true, simulated: true }.
import type { Id } from "@poltergeist/contracts/common.js";
import type { Episode } from "@poltergeist/contracts/episode.js";
import type { HauntDispatch } from "@poltergeist/contracts/haunt.js";
import type { Bus } from "@poltergeist/contracts/hub-types.js";
import type { OperatorCommand } from "@poltergeist/contracts/operator.js";
import { newId } from "../server/ids.js";

export class FakeWorld {
  /** Set to make the next injection fail (ok: false). */
  failNext = false;
  current: Episode | null = null;
  private pending: Promise<void>[] = [];
  private manual: (() => unknown)[] = [];
  private round = 0;
  private endTimer: NodeJS.Timeout | null = null;

  constructor(
    private bus: Bus,
    private now: () => number = Date.now,
    /** injectDelayMs: answer after this delay. Omitted: hold answers until flush() (tests). */
    private opts: { injectDelayMs?: number } = {},
  ) {
    bus.subscribe(["haunt.dispatch"], (e) => this.onDispatch(e.payload as HauntDispatch));
  }

  startEpisode(opts: { maxDurationMs?: number; match?: Episode["match"]; autoEnd?: boolean } = {}): Id {
    if (this.current) this.endEpisode("operator_stop");
    const episode: Episode = {
      episodeId: newId("ep", this.now()),
      sessionId: null,
      mode: "replay",
      driver: "brain",
      seed: { kind: "text", prompt: "A long venue hallway with a wood arch at the far end" },
      task: { targetLabel: "exit arch", instruction: "Walk through the wood arch at the end of the hallway" },
      policyVersion: "v1",
      round: ++this.round,
      startedAt: this.now(),
      maxDurationMs: opts.maxDurationMs ?? 60_000,
      ...(opts.match ? {match: opts.match} : {}),
    };
    this.bus.publish("episode.started", "world", episode, episode.episodeId);
    this.current = episode;
    if (opts.autoEnd) {
      const ms = opts.match?.clockMode === "wall" ? opts.match.deadline-this.now() : opts.match?.durationMs ?? episode.maxDurationMs;
      this.endTimer = setTimeout(() => this.endEpisode("timeout"), Math.max(0,ms));
    }
    return episode.episodeId;
  }

  endEpisode(reason: "timeout" | "operator_stop" | "success_claim" = "timeout"): void {
    const ep = this.current;
    if (!ep) return;
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    this.current = null;
    const endedAt = this.now();
    this.bus.publish(
      "episode.ended",
      "world",
      {
        episodeId: ep.episodeId,
        endedAt,
        durationMs: Math.max(0, endedAt - ep.startedAt),
        reason,
        genieClosedCleanly: null,
        artifacts: { eventsPath: `data/episodes/${ep.episodeId}/events.jsonl`, framesDir: `data/episodes/${ep.episodeId}/frames` },
      },
      ep.episodeId,
    );
  }

  /** Publish an operator command the way /operator would. */
  operator(cmd: OperatorCommand): void {
    this.bus.publish("operator.command", "operator", cmd);
  }

  /** Resolve once every pending injection has been answered (tests). */
  async flush(): Promise<void> {
    for (const answer of this.manual.splice(0)) answer();
    while (this.pending.length) await Promise.all(this.pending.splice(0));
  }

  private onDispatch(d: HauntDispatch): void {
    const ep = this.current;
    const t = ep ? Math.max(0, this.now() - ep.startedAt) : 0;
    const ok = !this.failNext;
    this.failNext = false;
    const answer = () =>
      this.bus.publish(
        "haunt.injected",
        "world",
        { hauntId: d.hauntId, episodeId: d.episodeId, t, ok, simulated: true, ...(ok ? {} : { error: "fake world: forced failure" }) },
        d.episodeId,
      );
    const delay = this.opts.injectDelayMs;
    if (delay === undefined) {
      this.manual.push(answer); // tests: answered on flush()
      return;
    }
    this.pending.push(new Promise<void>((r) => setTimeout(() => { answer(); r(); }, delay)));
  }
}

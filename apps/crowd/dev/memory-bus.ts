// In-memory Bus (C18 shape) for crowd tests and the local dev hub, until
// World's hub is on main. Validates the payloads crowd produces or consumes and
// throws on invalid ones, like the real hub.
import type { ZodTypeAny } from "zod";
import type { Id, Source } from "@poltergeist/contracts/common.js";
import { Episode, EpisodeEnded } from "@poltergeist/contracts/episode.js";
import { HauntDispatch, HauntPublic } from "@poltergeist/contracts/haunt.js";
import { HauntInjected } from "@poltergeist/contracts/haunt-injected.js";
import type { Bus, Envelope, EventType } from "@poltergeist/contracts/hub-types.js";
import { OperatorCommand } from "@poltergeist/contracts/operator.js";
import { Scoreboard } from "@poltergeist/contracts/scoreboard.js";
import { Verdict } from "@poltergeist/contracts/verdict.js";
import { newId } from "../server/ids.js";

const SCHEMAS: Partial<Record<EventType, ZodTypeAny>> = {
  "episode.started": Episode,
  "episode.ended": EpisodeEnded,
  "haunt.public": HauntPublic,
  "haunt.dispatch": HauntDispatch,
  "haunt.injected": HauntInjected,
  "verdict.provisional": Verdict,
  "verdict.final": Verdict,
  "scoreboard.updated": Scoreboard,
  "operator.command": OperatorCommand,
};

export class MemoryBus implements Bus {
  private log: Envelope[] = [];
  private subs = new Set<{ types: Set<EventType> | "*"; handler: (e: Envelope) => void }>();

  constructor(private now: () => number = Date.now) {}

  publish<T extends EventType>(type: T, source: Source, payload: unknown, episodeId?: Id): Envelope<T> {
    const schema = SCHEMAS[type];
    if (schema) {
      const r = schema.safeParse(payload);
      if (!r.success) throw new Error(`bus: invalid ${type} from ${source}: ${JSON.stringify(r.error.issues)}`);
    }
    const env: Envelope<T> = { v: 1, id: newId("ev", this.now()), type, ts: this.now(), source, payload, ...(episodeId ? { episodeId } : {}) };
    this.log.push(env);
    for (const s of [...this.subs]) {
      if (s.types === "*" || s.types.has(type)) s.handler(env);
    }
    return env;
  }

  subscribe(types: EventType[] | "*", handler: (e: Envelope) => void): () => void {
    const sub = { types: types === "*" ? ("*" as const) : new Set(types), handler };
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  history(filter: { episodeId?: Id; types?: EventType[]; since?: number }): Envelope[] {
    return this.log.filter(
      (e) =>
        (!filter.episodeId || e.episodeId === filter.episodeId) &&
        (!filter.types || filter.types.includes(e.type)) &&
        (filter.since === undefined || e.ts >= filter.since),
    );
  }
}

// TEMPORARY stand-in for World's packages/contracts/src/hub-types.ts (C18).
// Only the parts Crowd uses. Event payloads are loosely typed here because the
// registry (World-owned) is not on main yet. Delete once World's scaffold lands.
import type { FastifyInstance } from "fastify";
import type { EpochMs, Id, Instance, Lane, Source } from "./common.js";

export type EventType =
  | "episode.started" | "episode.ended" | "tick"
  | "haunt.public" | "haunt.dispatch" | "haunt.injected"
  | "verdict.provisional" | "verdict.final" | "policy.promoted"
  | "scoreboard.updated" | "cost.updated" | "operator.command"
  | "lane.health" | "bus.error";

export interface Envelope<T extends EventType = EventType> {
  v: 1;
  id: Id;
  type: T;
  ts: EpochMs;
  source: Source;
  episodeId?: Id;
  payload: unknown;
}

export interface Bus {
  publish<T extends EventType>(type: T, source: Source, payload: unknown, episodeId?: Id): Envelope<T>;
  subscribe(types: EventType[] | "*", handler: (e: Envelope) => void): () => void;
  history(filter: { episodeId?: Id; types?: EventType[]; since?: EpochMs }): Envelope[];
}

export interface HubContext {
  bus: Bus;
  dataDir: string;
  env: Record<string, string | undefined>;
  instance: Instance;
  log: (lane: Lane, msg: string, extra?: object) => void;
}

export interface LaneModule {
  lane: Lane;
  kind: "real" | "fake";
  register(app: FastifyInstance, ctx: HubContext): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  close?(): Promise<void>;
}

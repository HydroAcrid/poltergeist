// Scene source for the conductor: turns World's GET /rehearsal/state (real bodies in
// test/fixtures/rehearsal-*.json) into the conductor's SceneObservation. When World ships a
// shared `scene.observed` event, only this file changes.
import type { EffectKind, SceneObservation } from "./conductor.js";
import { kindOf } from "./conductor.js";

/** World's prop `kind` words → the conductor's effect kinds, and a short noun for public reasons. */
const WORLD_KIND: Record<string, { kind: EffectKind; noun: string }> = {
  banana: { kind: "floor_prop", noun: "banana peel" }, peel: { kind: "floor_prop", noun: "banana peel" },
  chair: { kind: "floor_prop", noun: "chair" }, mop: { kind: "floor_prop", noun: "mop bucket" }, bucket: { kind: "floor_prop", noun: "mop bucket" },
  marbles: { kind: "floor_prop", noun: "marble spill" }, box: { kind: "floor_prop", noun: "box" }, boxes: { kind: "floor_prop", noun: "box" },
  papers: { kind: "airborne", noun: "paper storm" }, paper: { kind: "airborne", noun: "paper storm" }, balloons: { kind: "airborne", noun: "balloon bunch" }, leaves: { kind: "airborne", noun: "leaf swirl" },
  fog: { kind: "visibility", noun: "fog bank" }, smoke: { kind: "visibility", noun: "fog bank" },
  lights: { kind: "lighting", noun: "flicker" }, flicker: { kind: "lighting", noun: "flicker" }, power: { kind: "lighting", noun: "blackout" },
  door: { kind: "sign", noun: "painted door" }, sign: { kind: "sign", noun: "sign" },
};

/** Effect kinds the trailing camera can show. The ceiling isn't in shot. */
export const DEFAULT_PRODUCIBLE: EffectKind[] = ["floor_prop", "airborne", "lighting", "visibility", "sign", "audio", "other"];
const AHEAD = 0.3; // a prop up to 30% of the hall ahead, in the robot's lane, is "in the beam"

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const set = (v: unknown) => v === true || (typeof v === "number" && v > 0);

export function sceneFromRehearsal(json: unknown, now: number, producible: EffectKind[] = DEFAULT_PRODUCIBLE): SceneObservation | undefined {
  if (!json || typeof json !== "object") return undefined;
  const body = json as Record<string, unknown>;
  const r = (body.round && typeof body.round === "object" ? body.round : body) as Record<string, unknown>;
  const phase = typeof r.phase === "string" ? r.phase : "";
  if (!/play|live|open/.test(phase)) return undefined; // no round to conduct (lobby, ended, …)
  const robotProgress = Math.min(1, Math.max(0, num(r.depth) ?? 0));
  const robotLane = num(r.lane) ?? 0;
  const deadline = num(r.deadline) ?? 0;
  const playing = /play|live/.test(phase);
  const props = Array.isArray(r.props) ? (r.props as Record<string, unknown>[]) : [];
  return {
    t: playing ? Math.max(0, now - (num(r.startedAt) ?? now)) : 0,
    observedAt: now,
    robotProgress,
    timeRemainingMs: playing && deadline > 0 ? Math.max(0, deadline - now) : 60_000,
    cameraStable: r.cameraStable !== false,
    obstacles: props
      .filter((p) => set(p.acked) || set(p.placedAt) || set(p.sentAt))
      .map((p) => {
        const word = String(p.kind ?? "").toLowerCase();
        const known = WORLD_KIND[word];
        const kind = known?.kind ?? kindOf({ tags: [], text: String(p.name ?? word) });
        const depth = num(p.depth) ?? robotProgress + 0.1;
        const lane = num(p.lane) ?? robotLane;
        const ahead = depth - robotProgress;
        const offPath = p.placement === "off-path";
        const inBeam = !offPath && ahead > 0 && ahead <= AHEAD && Math.abs(lane - robotLane) < 0.5;
        return { label: known?.noun ?? "prop", kind, inBeam: inBeam || p.placement === "in-path", progress: depth };
      }),
    producible,
    seenHauntIds: props.filter((p) => set(p.seen) || set(p.reactedAt)).map((p) => String(p.id ?? p.hauntId ?? "")).filter(Boolean),
  };
}

/**
 * Polls World's rehearsal state for the conductor. Returns the latest scene, or undefined if
 * the last good read is older than `maxAgeMs` (the conductor then falls back to FIFO).
 */
export function createRehearsalSceneSource(url: string, opts: { intervalMs?: number; maxAgeMs?: number; fetchImpl?: typeof fetch; now?: () => number; producible?: EffectKind[] } = {}) {
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let last: { at: number; body: unknown } | null = null;
  const poll = async () => {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) last = { at: now(), body: await res.json() };
    } catch {
      // keep the last good read; staleness turns the conductor back to FIFO
    }
  };
  const timer = setInterval(poll, opts.intervalMs ?? 1000);
  void poll();
  return {
    scene(): SceneObservation | undefined {
      if (!last || now() - last.at > (opts.maxAgeMs ?? 3000)) return undefined;
      return sceneFromRehearsal(last.body, now(), opts.producible);
    },
    stop() {
      clearInterval(timer);
    },
  };
}

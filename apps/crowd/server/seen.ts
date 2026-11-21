// Interim "Seen in the hallway" rule (Brain's suggestion on #2), until World publishes a
// camera-confirmed event: after haunt.injected { ok: true } at t, the haunting counts as seen
// at the first tick within the window whose perception.hazards gains a label it didn't have
// just before t. The observed response is that tick's display-safe rationale (≤ 60 chars).
// Heuristic: the player noticing a hazard is not proof of what the audience sees.

export interface SeenTick {
  seq: number;
  t: number;
  perception: { hazards: { label: string }[] };
  rationale: string;
}

export interface SeenInjection {
  hauntId: string;
  t: number;
  ok: boolean;
}

export type SeenResult =
  | { seen: true; hauntId: string; t: number; seq: number; label: string; response: string }
  | { seen: false; hauntId: string };

export const SEEN_WINDOW_MS = 6_000;

export function detectSeen(inj: SeenInjection, ticks: SeenTick[], windowMs = SEEN_WINDOW_MS): SeenResult {
  if (!inj.ok) return { seen: false, hauntId: inj.hauntId };
  const ordered = [...ticks].sort((a, b) => a.t - b.t || a.seq - b.seq);
  const before = ordered.filter((k) => k.t <= inj.t).at(-1);
  const baseline = new Set((before?.perception.hazards ?? []).map((h) => h.label.toLowerCase()));
  for (const k of ordered) {
    if (k.t <= inj.t) continue;
    if (k.t > inj.t + windowMs) break;
    const gained = k.perception.hazards.find((h) => !baseline.has(h.label.toLowerCase()));
    if (gained) return { seen: true, hauntId: inj.hauntId, t: k.t, seq: k.seq, label: gained.label, response: k.rationale.slice(0, 60) };
  }
  return { seen: false, hauntId: inj.hauntId };
}

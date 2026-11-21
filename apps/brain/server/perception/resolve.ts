import type { Perception } from "@poltergeist/contracts/tick-response.js";
import type { Candidate, PerceptionResult, Scene } from "./types.js";

export interface Resolved {
  /** What goes into the TickResponse. */
  perception: Perception;
  /** Set when ≥ 2 candidates remain and nothing tells them apart. */
  ambiguous?: Candidate[];
  /** Third-person scene, when the adapter reports one. */
  scene?: Scene;
}

/**
 * Turn an adapter result into one contract Perception.
 * - Candidates whose depth reads `flat` (painted or printed) are dropped.
 * - If exactly one `recessed` candidate remains, it is the target.
 * - If one candidate remains, it is the target.
 * - If several remain with no depth cue, report not-visible plus the candidates
 *   as unconfirmed so the controller changes viewpoint instead of choosing.
 */
export function resolvePerception(result: PerceptionResult): Resolved {
  const { candidates, scene, ...rest } = result;
  if (scene && !result.error) return { perception: rest, scene };
  if (!candidates || candidates.length < 2 || result.error) return { perception: rest };

  const meta = { model: rest.model, latencyMs: rest.latencyMs, hazards: rest.hazards };
  const solid = candidates.filter((c) => c.depth !== "flat");
  const recessed = solid.filter((c) => c.depth === "recessed");
  const pick = recessed.length === 1 ? recessed[0] : solid.length === 1 ? solid[0] : undefined;

  if (pick) {
    return { perception: { ...meta, visible: true, point: pick.point, ...(pick.box ? { box: pick.box } : {}), conf: pick.conf } };
  }
  if (solid.length === 0) return { perception: { ...meta, visible: false, conf: 0 } };

  const unconfirmed = solid.slice(0, 5).map((c) => ({ label: "unconfirmed door", point: c.point }));
  return {
    perception: { ...meta, visible: false, conf: Math.max(...solid.map((c) => c.conf)) / 2, hazards: [...meta.hazards, ...unconfirmed].slice(0, 5) },
    ambiguous: solid,
  };
}

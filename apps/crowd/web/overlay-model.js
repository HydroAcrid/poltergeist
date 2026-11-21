// Pure logic for /overlay (no DOM). Shared by the page and the tests.
//
// Two inputs:
//   crowd: GET /api/crowd/state (display-safe: moderated text and ghost names only)
//   world: GET /rehearsal/state (World's rehearsal route, PROVISIONAL field names until World
//          posts a sample). Only normalizeRehearsal() knows World's names, so matching the real
//          shape later is a one-function change.

export const STALE_MS = 3000; // robot position older than this is "not reliable"
export const CARD_MS = 8000; // a stage change shows the card this long, then it folds to the top margin

/** Stage order for one haunting. Higher means further along. */
export const STAGES = ["upnext", "sending", "sent", "seen", "inPath", "reacted"];

export const STAGE_LABEL = {
  upnext: "Up next",
  sending: "Sending to the hallway",
  sent: "Sent to the hallway",
  seen: "Seen in the hallway",
  inPath: "In the robot's path",
  reacted: "Robot reacted",
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const time = (v) => (v === true ? 0 : num(v)); // a boolean flag or an epoch-ms timestamp

/** Robot x as a 0..1 fraction of the frame width, from [y,x] 0..1000, {x,y} 0..1 or {x,y} 0..1000. */
export function feetX(feet) {
  if (!feet) return undefined;
  if (Array.isArray(feet)) {
    const x = num(feet[1]);
    return x === undefined ? undefined : x / 1000;
  }
  const x = num(feet.x);
  if (x === undefined) return undefined;
  return x > 1 ? x / 1000 : x;
}

/** World's /rehearsal/state → the overlay's own shape. Tolerant of missing or unknown fields. */
export function normalizeRehearsal(json) {
  const r = json && typeof json === "object" ? json.round ?? json : null;
  if (!r || typeof r !== "object") return null;
  const feet = r.trackedFeet;
  // World (#2): timestamps are Unix ms; trackedAt is the latest vision time; `observed` is a
  // source-frame number, not a time; trackedFeet is [y,x] 0–1000 averaging both boots.
  const obsAt = num(r.trackedAt) ?? num(r.observedAt) ?? num(r.observed?.at) ?? num(feet?.at);
  const props = Array.isArray(r.props) ? r.props : [];
  return {
    phase: typeof r.phase === "string" ? r.phase : undefined,
    serverNow: num(r.now) ?? num(json.now), // lets the page correct for clock skew
    deadline: num(r.deadline),
    fear: num(r.fear) ?? (Array.isArray(r.fear) ? r.fear.length : undefined),
    robotX: feetX(Array.isArray(feet) || !feet?.point ? feet : feet.point),
    observedAt: obsAt,
    props: props
      .map((p) => ({
        hauntId: typeof p?.hauntId === "string" ? p.hauntId : typeof p?.id === "string" ? p.id : undefined,
        acked: time(p?.acked),
        seen: time(p?.seen),
        inPath: time(p?.inPath),
        reactedAt: time(p?.reactedAt),
        reaction: typeof p?.reaction === "string" ? p.reaction.slice(0, 60) : undefined,
      }))
      .filter((p) => p.hauntId),
  };
}

/** Where the robot is, if World's observation is fresh enough to trust. */
export function reliableRobotX(world, now) {
  if (!world || world.robotX === undefined) return undefined;
  if (world.observedAt === undefined || now - world.observedAt > STALE_MS) return undefined;
  return world.robotX;
}

/** Card side: opposite the robot. Unknown or stale position → null (use the top margin). */
export function cardSide(world, now) {
  const x = reliableRobotX(world, now);
  if (x === undefined) return null;
  return x < 0.5 ? "right" : "left";
}

/** The furthest stage one haunting has reached, combining Crowd's status with World's evidence. */
export function stageOf(crowdItem, worldProp) {
  let stage = crowdItem?.status === "dispatched" ? "sending" : crowdItem?.status === "injected" ? "sent" : null;
  if (worldProp) {
    if (worldProp.acked !== undefined && (!stage || STAGES.indexOf(stage) < STAGES.indexOf("sent"))) stage = "sent";
    if (worldProp.seen !== undefined) stage = "seen";
    if (worldProp.inPath !== undefined) stage = "inPath";
    if (worldProp.reactedAt !== undefined) stage = "reacted";
  }
  return stage;
}

/**
 * What the single card should say right now. Display text and the ghost name come only from
 * Crowd's display-safe state, never from World's prop payload.
 */
export function pickCard(crowd, world) {
  const hallway = crowd?.hallway ?? [];
  const props = new Map((world?.props ?? []).map((p) => [p.hauntId, p]));
  const latest = hallway[0];
  if (latest) {
    const prop = props.get(latest.hauntId);
    const stage = stageOf(latest, prop);
    if (stage) {
      return {
        key: latest.hauntId + ":" + stage,
        stage,
        label: STAGE_LABEL[stage],
        text: latest.moderated?.text ?? "",
        who: latest.displayName ?? "anon",
        reaction: stage === "reacted" ? prop?.reaction || "Robot reacted" : undefined,
      };
    }
  }
  const next = crowd?.queue?.[0];
  if (next) {
    return { key: next.hauntId + ":upnext", stage: "upnext", label: STAGE_LABEL.upnext, text: next.moderated?.text ?? "", who: next.displayName ?? "anon" };
  }
  return null;
}

/** "opening" | "live" | "result" | "idle", from World's phase when present, else Crowd's state. */
export function phaseOf(crowd, world) {
  const p = world?.phase?.toLowerCase();
  if (p) {
    if (/open|join|lobby|ready/.test(p)) return "opening";
    if (/live|play|run|active/.test(p)) return "live";
    if (/result|over|end|done|finish/.test(p)) return "result";
  }
  if (crowd?.episodeActive) return "live";
  return "idle";
}

/** Seconds left, from World's deadline when present, else Crowd's round end. */
export function secondsLeft(crowd, world, now) {
  const end = world?.deadline ?? crowd?.roundEndsAt;
  return end === undefined ? undefined : Math.max(0, Math.round((end - now) / 1000));
}

export function clock(s) {
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/** The big join QR is for the opening and the result only; during play it's a small Join pill. */
export function bigJoin(phase) {
  return phase === "opening" || phase === "result" || phase === "idle";
}

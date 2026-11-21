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
/** A boolean flag or an epoch-ms timestamp. true → 0 ("set, time unknown"); 0/false/null → undefined ("not yet"). */
const reached = (v) => (v === true ? 0 : typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

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
/** Reaction words World uses in props[].response / round.lastReaction → a short caption. */
const REACTION_TEXT = { flinch: "Robot flinches", stumble: "Robot stumbles", recover: "Robot recovers", avoid: "Robot steps around it", dodge: "Robot dodges it", startle: "Robot startles", pause: "Robot stops to look" };

/**
 * World's GET /rehearsal/state → the overlay's own shape. Matches World's real bodies (#2,
 * test/fixtures/rehearsal-*.json): timestamps are Unix ms and 0 means "not yet"; booleans for
 * acked/seen/inPath; `observed` is a frame number, not a time; trackedFeet is [y,x] 0–1000;
 * vision fields may sit on the body or on `round`. Tolerant of missing or unknown fields.
 */
export function normalizeRehearsal(json) {
  if (!json || typeof json !== "object") return null;
  const r = json.round && typeof json.round === "object" ? json.round : json;
  const pick = (k) => r[k] ?? json[k];
  const feet = pick("trackedFeet");
  const props = Array.isArray(pick("props")) ? pick("props") : [];
  const winner = pick("winner");
  const finishedAt = reached(pick("finishedAt"));
  const terminal = pick("terminal");
  return {
    phase: typeof r.phase === "string" ? r.phase : undefined,
    finished: Boolean(winner || finishedAt || terminal),
    winner: typeof winner === "string" ? winner : undefined,
    reason: typeof pick("reason") === "string" ? pick("reason") : undefined,
    serverNow: num(json.now) ?? num(r.now), // lets the page correct for clock skew
    deadline: reached(pick("deadline")),
    fear: num(pick("fear")) ?? (Array.isArray(pick("fear")) ? pick("fear").length : undefined),
    live: pick("live") === true,
    robotX: feetX(Array.isArray(feet) || !feet?.point ? feet : feet.point),
    observedAt: reached(pick("trackedAt")) ?? reached(pick("observedAt")),
    props: props
      .map((p) => {
        const reactedAt = reached(p?.reactedAt);
        const response = typeof p?.response === "string" ? p.response : undefined;
        return {
          hauntId: typeof p?.hauntId === "string" ? p.hauntId : typeof p?.id === "string" ? p.id : undefined,
          acked: reached(p?.acked) ?? reached(p?.placedAt) ?? reached(p?.sentAt),
          seen: reached(p?.seen),
          inPath: p?.inPath === true || p?.placement === "in-path" ? 0 : reached(p?.inPath === false ? undefined : p?.inPath),
          reactedAt,
          reaction: reactedAt === undefined ? undefined : typeof p?.reaction === "string" ? p.reaction.slice(0, 60) : REACTION_TEXT[response] ?? "Robot reacted",
          // World's display-safe copies, used only when Crowd's own state doesn't have this haunting.
          text: typeof p?.name === "string" ? p.name.slice(0, 60) : undefined,
          by: typeof p?.by === "string" ? p.by.slice(0, 16) : undefined,
        };
      })
      .filter((p) => p.hauntId),
    queue: (Array.isArray(json.queue) ? json.queue : [])
      .map((h) => ({ hauntId: typeof h?.id === "string" ? h.id : undefined, text: typeof h?.text === "string" ? h.text.slice(0, 60) : "", by: typeof h?.by === "string" ? h.by.slice(0, 16) : "anon" }))
      .filter((h) => h.hauntId && h.text),
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
  const card = (id, stage, text, who, prop) => ({
    key: id + ":" + stage, stage, label: STAGE_LABEL[stage], text, who,
    reaction: stage === "reacted" ? prop?.reaction || "Robot reacted" : undefined,
  });
  const latest = hallway[0];
  if (latest) {
    const prop = props.get(latest.hauntId);
    const stage = stageOf(latest, prop);
    if (stage) return card(latest.hauntId, stage, latest.moderated?.text ?? "", latest.displayName ?? "anon", prop);
  }
  // World's rehearsal host may run its own queue: use its newest prop when Crowd has nothing sent.
  const worldLatest = !latest ? (world?.props ?? []).at(-1) : undefined;
  if (worldLatest?.text) {
    const stage = stageOf(null, worldLatest);
    if (stage) return card(worldLatest.hauntId, stage, worldLatest.text, worldLatest.by ?? "anon", worldLatest);
  }
  const next = crowd?.queue?.[0];
  if (next) return card(next.hauntId, "upnext", next.moderated?.text ?? "", next.displayName ?? "anon");
  const worldNext = world?.queue?.[0];
  if (worldNext) return card(worldNext.hauntId, "upnext", worldNext.text, worldNext.by);
  return null;
}

/** "opening" | "live" | "result" | "idle", from World's phase when present, else Crowd's state. */
export function phaseOf(crowd, world) {
  if (world?.finished) return "result";
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

/** Result banner headline from World's winner/reason/fear. */
export function resultText(world) {
  const w = (world?.winner ?? "").toLowerCase();
  const why = (world?.reason ?? "").toLowerCase();
  if (/robot|player|agent/.test(w)) return "Robot escaped";
  if (/fear|scare/.test(why) || (world?.fear ?? 0) >= 3) return "👻 Audience wins: 3 scares";
  if (/time|clock|deadline/.test(why) || /audience|ghost|crowd/.test(w)) return "Audience wins: time's up";
  if (/interrupt|error|stall|watchdog/.test(why)) return "Interrupted: no winner";
  return "Round over";
}

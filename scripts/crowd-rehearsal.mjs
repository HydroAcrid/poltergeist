// Rehearse real phone traffic on one local Stage. Each audience member owns a
// cookie jar, an idea and a polling loop; a rejected idea can be revised in place.
// node scripts/crowd-rehearsal.mjs --people 30 --port 8931 --out /tmp/run.json
// To join an independently operated live round, use --url URL --presets-only.
import { spawn, execFileSync } from "node:child_process";
import { channel } from "node:diagnostics_channel";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    people: { type: "string", default: "30" },
    port: { type: "string", default: "8931" },
    repo: { type: "string", default: "." },
    out: { type: "string", default: "crowd-rehearsal.json" },
    url: { type: "string" },
    "presets-only": { type: "boolean" },
    "full-state": { type: "boolean" },
    "join-live": { type: "boolean" },
  },
});
const count = Number(values.people),
  root = resolve(values.repo);
if (!Number.isSafeInteger(count) || count < 1)
  throw Error("Expected positive --people");
const origin = new URL(values.url || "http://127.0.0.1:" + values.port);
if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
  throw Error("Use a local rehearsal host");
let paged = false;
const source = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const crowdWorkingTree = execFileSync("git", ["-C", root, "status", "--short", "--", "apps/crowd"], { encoding: "utf8" }).trim();
const sockets = new Map();
channel("undici:client:sendHeaders").subscribe(({ request, socket }) => {
  if (String(request.origin) === origin.origin && !sockets.has(socket)) {
    sockets.set(socket, { read: socket.bytesRead, written: socket.bytesWritten });
  }
});
const live = values["join-live"];
if (live && (!values.url || !values["presets-only"]))
  throw Error("Live attachment requires --url and --presets-only");
const plans = [
  {
    text: "A mop bucket on a loose caster rolls around the bend into the walking lane",
  },
  {
    text: "A gust lifts loose papers across the aisle just as the flashlight swings",
  },
  { text: "A curtain of ribbons drops down and blocks half of the aisle" },
  { text: "A hurricane tears the roof off the hallway" },
  { text: "Write a brand logo in neon letters on the door" },
  { preset: "marbles" },
  {
    text: "A sheet of reflective foil slowly unfurls across the next footstep",
  },
  { text: "A chair tips forward and rocks back into the walking lane" },
  { text: "A bank of fog drifts through a narrow gap between the booths" },
  { preset: "mop-bucket" },
];
const presetPlans = [
  "mop-bucket",
  "paper-gust",
  "marbles",
  "balloons",
  "chair-tips",
  "lights-flicker",
  "fog",
];
const clock = () => performance.now();
const clients = Array.from({ length: count }, (_, index) => ({
  index,
  cookie: "",
  name: null,
  own: new Map(),
  lastMine: [],
  revisions: 0,
  rateTests: 0,
  confirmedRetry: false,
}));
const metrics = new Map(),
  issues = new Set(),
  cues = [],
  phases = [],
  reactions = new Set(),
  props = new Map();
let child,
  ended = false,
  playing = false,
  active = 0,
  peakActive = 0,
  inFlight = 0,
  peakRequests = 0;
let retries = 0,
  expected429 = 0,
  readBytes = 0,
  peakRSS = 0,
  maxQueue = 0,
  everDispatched = new Set(),
  startTime,
  originalRoundId,
  result;
function issue(detail) {
  issues.add(detail);
}
const tally = (entries) =>
  entries.reduce((acc, key) => ((acc[key] = (acc[key] || 0) + 1), acc), {});
function distilled(values) {
  const ns = [...values].sort((a, b) => a - b);
  const pick = (p) =>
    Math.round((ns[Math.max(0, Math.ceil(p * ns.length) - 1)] || 0) * 10) / 10;
  return { p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: pick(1) };
}
async function request(path, client, body, expected = 200, host = false) {
  const start = clock(),
    method = body ? "POST" : "GET",
    key = method + " " + path;
  const m = metrics.get(key) || { ms: [], size: [], status: [], errors: 0 };
  metrics.set(key, m);
  peakRequests = Math.max(peakRequests, ++inFlight);
  try {
    const headers = {};
    const useTag = paged && path.includes("?waitingPage=");
    if (useTag && client.tag) headers["if-none-match"] = client.tag;
    if (client?.cookie) headers.cookie = client.cookie;
    if (host) headers["x-show-control"] = "1";
    if (body) headers["content-type"] = "application/json";
    const res = await fetch(new URL(path, origin), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    const bytes = await res.arrayBuffer(),
      size = bytes.byteLength;
    readBytes += size;
    m.ms.push(clock() - start);
    m.size.push(size);
    m.status.push(res.status);
    if (client && res.headers.has("set-cookie")) {
      const jar = res.headers.get("set-cookie").split(";")[0];
      if (client.cookie && client.cookie !== jar)
        issue("Device cookie changed for an existing client");
      client.cookie = jar;
    }
    if (res.status === 304 && useTag && client.cachedState) {
      if (size || res.headers.get("etag") !== client.tag) throw Error("Invalid unchanged state response");
      return client.cachedState;
    }
    if (res.status !== expected)
      throw Error(key + " returned " + res.status + "; expected " + expected);
    if (res.status === 429) expected429++;
    if (path === "/haunt") return;
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (useTag) {
      client.tag = res.headers.get("etag");
      if (!client.tag || !payload.waiting || payload.queue.length > payload.waiting.size + 1)
        throw Error("Invalid paged response");
      client.cachedState = payload;
    }
    return payload;
  } catch (err) {
    m.errors++;
    throw err;
  } finally {
    inFlight--;
  }
}
async function submit(person, body) {
  const response = await request("/api/crowd/haunt", person, body);
  if (!response.hauntId) throw Error("Submission missing receipt");
  person.own.set(response.hauntId, {
    status: "submitted",
    revised: false,
    revision: !!body.revisionOf,
  });
  return response.hauntId;
}
async function inspectPhone(person) {
  const state = await request(paged ? "/api/crowd/state?waitingPage=0" : "/api/crowd/state", person);
  if (!state.you?.ghostName) throw Error("Missing server-assigned ghost name");
  if (person.name && person.name !== state.you.ghostName)
    issue("Assigned name changed");
  person.name = state.you.ghostName;
  const queueSize = paged ? state.waiting.total + Number(state.queue.length > 0) : state.queue.length;
  maxQueue = Math.max(maxQueue, queueSize);
  if (
    state.queue.some(
      (h) =>
        !h.moderated?.safe ||
        h.raw ||
        h.deviceId ||
        h.moderated?.reason ||
        h.moderated?.suggestion,
    )
  )
    issue("Private or unapproved fields in public queue");
  if (
    state.hallway.some(
      (h) =>
        h.raw || h.deviceId || h.moderated?.reason || h.moderated?.suggestion,
    )
  )
    issue("Private fields in public hallway");
  for (const h of state.hallway) everDispatched.add(h.hauntId);
  for (const h of state.mine) {
    const own = person.own.get(h.hauntId);
    if (!own) {
      issue("A private receipt appeared for the wrong participant");
      continue;
    }
    own.status = h.status;
    if (h.status === "rejected" && !own.revision && !own.revised && !ended) {
      if (!h.moderated.reason || !h.moderated.suggestion) {
        issue("Rejected idea had no private recovery");
        continue;
      }
      own.revised = true;
      await submit(person, {
        text: h.moderated.suggestion,
        revisionOf: h.hauntId,
      });
      person.revisions++;
    }
  }
  person.lastMine = state.mine.map((h) => h.hauntId);
}
async function audience(person) {
  // Four fifths join in a two-second opening burst; one fifth joins during play.
  const late = person.index >= Math.ceil(count * 0.8);
  if (late) while (!playing && !ended) await sleep(120);
  await sleep(person.index === 0 ? 0 : 45 + ((person.index * 139) % 1950));
  if (ended) throw Error("Round ended before late join");
  peakActive = Math.max(peakActive, ++active);
  try {
    await Promise.all([request("/haunt"), request("/api/crowd/presets")]);
    await inspectPhone(person);
    const plan = values["presets-only"]
      ? { preset: presetPlans[person.index % presetPlans.length] }
      : plans[person.index % plans.length];
    await submit(person, plan);
    if (!values["presets-only"] && person.index % 30 === 1) {
      const limited = await request(
        "/api/crowd/haunt",
        person,
        { preset: "marbles" },
        429,
      );
      if (limited.error?.code !== "RATE_LIMITED")
        issue("Rate-limit probe had the wrong response");
      person.retryAt = Date.now() + 20500;
      person.rateTests++;
    }
    while (!ended) {
      const next = clock() + 2000;
      await inspectPhone(person);
      if (
        person.retryAt &&
        !person.confirmedRetry &&
        Date.now() >= person.retryAt
      ) {
        await submit(person, { preset: "marbles" });
        person.confirmedRetry = true;
        retries++;
      }
      await sleep(Math.max(0, next - clock()));
    }
    await inspectPhone(person);
    if (person.own.size !== person.lastMine.length)
      issue("Phone missing a final receipt");
  } finally {
    active--;
  }
}
async function monitor() {
  const until = Date.now() + 135000;
  try {
    while (Date.now() < until) {
      const { round, queue } = await request("/rehearsal/state");
      if (!round || round.id !== originalRoundId)
        throw Error("Stage round changed during rehearsal");
      if (phases.at(-1) !== round.phase) phases.push(round.phase);
      if (round.phase === "playing") playing = true;
      maxQueue = Math.max(maxQueue, queue.length);
      for (const p of round.upcoming || [])
        if (!cues.includes(p.id)) cues.push(p.id);
      for (const p of round.props) {
        props.set(p.id, {
          name: p.name,
          selectedAt: p.selectedAt,
          sentAt: p.sentAt,
          seen: p.seen,
          inPath: p.inPath,
          reacted: !!p.reactedAt,
        });
        if (p.reactedAt) reactions.add(p.id);
        if (p.selectedAt && !cues.includes(p.id)) cues.push(p.id);
      }
      if (child) {
        const memory = Number(
          execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], {
            encoding: "utf8",
          }).trim(),
        );
        peakRSS = Math.max(memory / 1024, peakRSS);
      }
      if (round.phase === "ended") {
        result = {
          reason: round.reason,
          winner: round.winner,
          brainTicks: round.seq,
          fear: round.fear,
          remainingQueued: queue.length,
        };
        return;
      }
      await sleep(350);
    }
    throw Error("Round failed to end");
  } finally {
    ended = true;
  }
}
async function run() {
  if (!values.url) {
    child = spawn(process.execPath, ["apps/world/rehearsal/run.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        PG_STAGE_PORT: values.port,
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null)
        throw Error(
          "Offline server exited before listening; choose a free port",
        );
      try {
        const r = await fetch(new URL("/rehearsal/state", origin));
        if (r.ok) break;
      } catch {}
      await sleep(150);
    }
  }
  const page = await (await fetch(new URL("/haunt", origin))).text();
  paged = !values["full-state"] && page.includes("waitingPage=");
  let state = await request("/rehearsal/state");
  if (live) {
    const before = state.round?.phase === "ended" ? state.round.id : null,
      until = Date.now() + 120000;
    while (
      !state.round ||
      state.round.phase === "ended" ||
      state.round.id === before
    ) {
      if (Date.now() > until)
        throw Error("Waiting for operator-started live round timed out");
      await sleep(250);
      state = await request("/rehearsal/state");
    }
    if (!state.round.live) throw Error("Expected live round");
    originalRoundId = state.round.id;
  } else {
    if (state.canLive || state.round || state.queue.length)
      throw Error("Use a fresh keyless rehearsal server");
    originalRoundId = (
      await request("/rehearsal/start", null, { mode: "offline" }, 200, true)
    ).id;
  }
  startTime = clock();
  const tasks = await Promise.allSettled([monitor(), ...clients.map(audience)]);
  for (const r of tasks) if (r.status === "rejected") issue(String(r.reason));
  if (new Set(clients.map((p) => p.name).filter(Boolean)).size !== count)
    issue("Assigned names are missing or duplicated");
  if (new Set(clients.map((p) => p.cookie).filter(Boolean)).size !== count)
    issue("Session cookies are missing or duplicated");
  if (!everDispatched.size || !result?.brainTicks)
    issue("No end-to-end dispatch or Brain ticks");
  if (!live && !reactions.size)
    issue("Offline round produced no verified reaction");
  if (!values["presets-only"] && !clients.some((c) => c.revisions))
    issue("No rejected idea revision occurred");
  const receipts = clients.flatMap((p) => [...p.own.values()]);
  const report = {
    source,
    crowdWorkingTree,
    phonePoll: paged ? "paged-conditional" : "full",
    httpWireReceivedBytes: [...sockets].reduce((sum, [socket, start]) => sum + socket.bytesRead - start.read, 0),
    httpWireSentBytes: [...sockets].reduce((sum, [socket, start]) => sum + socket.bytesWritten - start.written, 0),
    runtimes: { node: process.version, platform: process.platform },
    mode: live
      ? "native Genie with preset-only audience"
      : "one keyless loopback server, real Crowd routes and scheduler, Brain fixtures and World offline renderer",
    count,
    uniqueNames: new Set(clients.map((p) => p.name).filter(Boolean)).size,
    uniqueCookies: new Set(clients.map((p) => p.cookie).filter(Boolean)).size,
    participantsWithFinalReceipts: clients.filter(
      (p) => p.own.size && p.own.size === p.lastMine.length,
    ).length,
    peakActive,
    peakSimultaneousRequests: peakRequests,
    durationSeconds: +((clock() - startTime) / 1000).toFixed(2),
    phases,
    result,
    maxQueue,
    originalStatuses: tally(
      receipts.filter((r) => !r.revision).map((r) => r.status),
    ),
    revisionStatuses: tally(
      receipts.filter((r) => r.revision).map((r) => r.status),
    ),
    suggestedRevisions: clients.reduce((sum, c) => sum + c.revisions, 0),
    expected429,
    successfulRateRetries: retries,
    publicDispatched: everDispatched.size,
    selected: cues.length,
    worldProps: [...props.values()],
    verifiedReactions: reactions.size,
    httpBodyBytes: readBytes,
    sampledHostPeakRSSMiB: child ? Math.round(peakRSS) : null,
    requests: Object.fromEntries(
      [...metrics].map(([k, m]) => [
        k,
        {
          count: m.status.length,
          errors: m.errors,
          status: tally(m.status),
          latencyMs: distilled(m.ms),
          bodyBytes: distilled(m.size),
          totalBodyBytes: m.size.reduce((a, b) => a + b, 0),
        },
      ]),
    ),
    issues: [...issues],
  };
  await mkdir(dirname(resolve(values.out)), { recursive: true });
  await writeFile(values.out, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      report: values.out,
      ...result,
      count,
      publicDispatched: everDispatched.size,
      reactions: reactions.size,
      issues: [...issues],
    }),
  );
  if (issues.size) process.exitCode = 1;
}
try {
  await run();
} finally {
  ended = true;
  child?.kill("SIGTERM");
}

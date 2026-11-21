// Local dev hub for the crowd lane until World's hub is on main:
// in-memory bus + crowd's stand-in World + the real crowd module, with a tiny
// /dev control page to start and end rounds. Listens on all interfaces so
// phones on the same Wi-Fi can open /haunt.
//   pnpm dev            (PORT defaults to 8788)
import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeWorld } from "./fake-world.js";
import { MemoryBus } from "./memory-bus.js";
import { createCrowdModule } from "../server/index.js";

const port = Number(process.env.PORT ?? 8788);
const bus = new MemoryBus();
const world = new FakeWorld(bus, Date.now, { injectDelayMs: 800 });
const app = Fastify({ logger: false });

const crowd = createCrowdModule();
await crowd.register(app, {
  bus,
  dataDir: process.env.PG_DATA_DIR ?? "./data-haunt",
  env: { ...process.env, PG_OPERATOR_TOKEN: process.env.PG_OPERATOR_TOKEN || "dev-operator" },
  instance: "local",
  log: (lane, msg, extra) => console.log(`[${lane}] ${msg}`, extra ?? ""),
});

bus.subscribe("*", (e) => {
  const p = e.payload as { status?: string; text?: string; hauntId?: string; ok?: boolean };
  console.log(`bus ${e.type.padEnd(16)} ${e.source.padEnd(8)} ${p.hauntId ?? ""} ${p.status ?? p.text ?? (p.ok !== undefined ? `ok=${p.ok}` : "")}`);
});

app.post("/dev/round/start", async () => ({ episodeId: world.startEpisode({ maxDurationMs: 60_000, autoEnd: true }) }));
app.post("/dev/round/end", async () => {
  world.endEpisode("operator_stop");
  return { ok: true };
});
app.get("/dev", async (_req, reply) =>
  reply.type("text/html").send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Crowd dev</title><body style="font:16px system-ui;max-width:520px;margin:24px auto;padding:0 16px">
<h1>Crowd dev hub</h1><p>Stand-in World (answers each dispatch after 0.8 s). Rounds last 60 s.</p>
<button onclick="fetch('/dev/round/start',{method:'POST'}).then(r=>r.json()).then(j=>out.textContent='started '+j.episodeId)">Start round</button>
<button onclick="fetch('/dev/round/end',{method:'POST'}).then(()=>out.textContent='ended')">End round</button>
<p id=out></p><p><a href="/haunt">Open /haunt</a></p></body>`),
);

// DEV-ONLY stand-in for World's GET /rehearsal/state, shaped like World's description on #2
// (Unix-ms timestamps, trackedAt, integer `observed` frame, trackedFeet [y,x] 0–1000, props with
// acked/seen/inPath/reactedAt). The real route comes from World's rehearsal host. Each injected
// haunting is walked through seen (+1.5 s), in path (+3 s) and reacted (+5 s) so the overlay can
// be demoed; the robot drifts left to right across the round.
const injectedAt = new Map<string, number>();
bus.subscribe(["haunt.injected"], (e) => {
  const p = e.payload as { hauntId: string; ok: boolean };
  if (p.ok) injectedAt.set(p.hauntId, Date.now());
});
bus.subscribe(["episode.started"], () => injectedAt.clear());
app.get("/rehearsal/state", async () => {
  const now = Date.now();
  const ep = world.current;
  const frac = ep ? Math.min(1, (now - ep.startedAt) / ep.maxDurationMs) : 0;
  // Same field conventions as World's real bodies (apps/crowd/test/fixtures/rehearsal-*.json):
  // id/placedAt/acked/seen/inPath booleans, reactedAt 0 until it happens, response "flinch".
  const props = [...injectedAt].map(([id, at]) => ({
    id,
    placedAt: at,
    acked: true,
    seen: now - at > 1500,
    inPath: now - at > 3000,
    response: "flinch",
    reactedAt: now - at > 5000 ? at + 5000 : 0,
  }));
  return {
    round: {
      phase: ep ? "playing" : "opening",
      deadline: ep ? ep.startedAt + ep.maxDurationMs : now + 24_000,
      startedAt: ep ? ep.startedAt : 0,
      fear: Math.min(3, props.filter((p) => p.reactedAt).length),
      props,
      winner: null,
      finishedAt: 0,
      live: false,
    },
    trackedFeet: [740, Math.round(250 + frac * 550)],
    trackedAt: now - 300,
    observed: Math.round(frac * 1440),
    queue: [],
    now,
  };
});

// Design mocks (apps/crowd/docs) and World's shared art (apps/world/robot-v1), read-only.
const here = dirname(fileURLToPath(import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png" };
const serveFrom = (root: string) => async (req: { params: unknown }, reply: { code: (n: number) => { send: (b: string) => unknown }; type: (t: string) => { send: (b: Buffer) => unknown } }) => {
  const rel = normalize(String((req.params as Record<string, string>)["*"] ?? "")).replace(/^(\.\.(\/|$))+/, "");
  const file = resolve(root, rel);
  if (!file.startsWith(root) || !existsSync(file)) return reply.code(404).send("not found");
  return reply.type(TYPES[extname(file)] ?? "application/octet-stream").send(readFileSync(file));
};
app.get("/dev/docs/*", serveFrom(resolve(here, "../docs")));
app.get("/world/robot-v1/*", serveFrom(resolve(here, "../../world/robot-v1")));

await app.listen({ port, host: "0.0.0.0" });
const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
console.log(`crowd dev hub on http://localhost:${port}/haunt${lan ? `  ·  phones: http://${lan}:${port}/haunt` : ""}  ·  controls: /dev`);

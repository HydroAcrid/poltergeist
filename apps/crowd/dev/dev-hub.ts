// Local dev hub for the crowd lane until World's hub is on main:
// in-memory bus + crowd's stand-in World + the real crowd module, with a tiny
// /dev control page to start and end rounds. Listens on all interfaces so
// phones on the same Wi-Fi can open /haunt.
//   pnpm dev            (PORT defaults to 8788)
import Fastify from "fastify";
import { networkInterfaces } from "node:os";
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

await app.listen({ port, host: "0.0.0.0" });
const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
console.log(`crowd dev hub on http://localhost:${port}/haunt${lan ? `  ·  phones: http://${lan}:${port}/haunt` : ""}  ·  controls: /dev`);

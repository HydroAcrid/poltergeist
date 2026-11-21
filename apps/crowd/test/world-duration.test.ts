import { afterEach, expect, it, vi } from "vitest";
import fastify from "fastify";
import { resolve } from "node:path";
import { MemoryBus } from "../dev/memory-bus";
import { createCrowdModule } from "../server/index";
import { newId } from "../server/ids";
import { Episode } from "@poltergeist/contracts/episode.js";

type Provider = {onMessage: (message: unknown) => void; onClose: (terminal: string) => void};
const hosts: Array<ReturnType<typeof fastify>> = [];
afterEach(async () => {
  for (const app of hosts.splice(0)) await app.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function world(badId = false, library?: unknown) {
  vi.useFakeTimers({toFake:["Date","setInterval","clearInterval"]});
  const app = fastify(); hosts.push(app);
  const bus = new MemoryBus();
  const providers: Provider[] = [], stop = vi.fn(), review = vi.fn(async () => ({passes:true}));
  const path = resolve(__dirname,"../../world/rehearsal/server.mjs");
  const {registerStage} = await import(path);
  const root = resolve(__dirname,"../../world/rehearsal");
  const round = await registerStage(app,{
    bus,root,library,captureDir:root,chapterTiming:{matchMs:600_000,cutMs:3000,limitMs:90_000},reviewSeed:review,makePilot:()=>()=>({action:{key:"NOOP"}}),
    newId:()=>badId ? "invalid-episode" : newId("ep"),
    launchLive:(provider:Provider)=>{providers.push(provider);return {stop,send:vi.fn()};},
  });
  const crowd = createCrowdModule({lobbyPhase:round.lobbyPhase,prepared:round.prepared,renderWindow:round.renderWindow,matchClock:()=>{
    const r=round();return (r?.chapters || r?.playMode === "prepared-show" || r?.playMode === "buffered-live") && ["playing","handoff"].includes(r.phase) ? r : undefined;
  },config:{roundEveryMs:null,seededFallback:false}});
  await crowd.register(app,{bus,env:{PG_MODERATION_ADAPTER:"rules-only"},instance:"local",dataDir:"./data-test",log:()=>{}});
  app.addHook("onClose",async()=>{await crowd.close?.();});
  const seed = Buffer.alloc(200);seed.writeUInt16BE(0xffd8);
  const post=(url:string,payload={})=>app.inject({method:"POST",url,headers:{"x-show-control":"1"},payload});
  await post("/rehearsal/reset-photo");
  return {bus,providers,stop,review,round,app,post,
    start:(minutes?:number)=>post("/rehearsal/start",{mode:"genie",seed:seed.toString("base64"),...(minutes?{showMinutes:minutes,chapters:true}:{})}),
    tick:(ms:number)=>vi.advanceTimersByTimeAsync(ms),
    state:async()=>(await app.inject("/rehearsal/state")).json(),
    phone:async()=>(await app.inject("/api/crowd/state")).json(),
    end:()=>post("/rehearsal/stop"),
  };
}

it.each([5,10])("publishes one compatible C03 start for a %i-minute World match through the real bus",async minutes=>{
  const h=await world();
  expect((await h.start(minutes)).statusCode).toBe(200);
  expect((await h.phone()).episodeActive).toBe(false);
  await h.tick(3000);
  h.providers[0]!.onMessage({frame:"AQI="});
  const starts=h.bus.history({types:["episode.started"]});
  expect(starts).toHaveLength(1);
  const ep=Episode.parse(starts[0]!.payload);
  expect(ep.maxDurationMs).toBeLessThanOrEqual(90_000);
  // The previous C03 shape ignores the additive extension and enforces 90s.
  expect(Episode.omit({match:true}).parse(starts[0]!.payload).maxDurationMs).toBe(ep.maxDurationMs);
  expect(ep.match?.durationMs).toBe(minutes*60_000);
  expect(ep.match?.clockMode).toBe(minutes===5?"wall":"active");
  expect((await h.phone()).roundEndsAt).toBe(h.round().deadline);
  expect(h.round().deadline).toBe((minutes===5?h.round().requestedAt:ep.startedAt)+minutes*60_000);
  const originalDeadline = h.round().deadline;
  await h.tick(3150);
  const checkpoint = Buffer.alloc(160);checkpoint.writeUInt16BE(0xffd8);checkpoint.writeUInt16BE(0xffd9,158);
  h.providers[0]!.onMessage({observed:83,observedAt:Date.now(),trackingPlacementReady:true,trackingNavigationHeld:false,
    checkpoint:checkpoint.toString("base64"),
    scene:{visible:true,playerCount:1,playerMatch:true,pose:"upright",threat:"ordinary",shoulderView:"rear-right",
      aisleHeading:"diagonal-right",rightFloorVisible:true,bodyBox:[340,65,924,351],feetVisible:true,
      feet:{left:[912,197],right:[920,230]},ahead:[718,553],obstacles:[]}});
  await h.tick(150);
  expect(h.round().phase).toBe("handoff");
  const paused=await h.phone();
  expect(paused.episodeActive).toBe(true);
  if (minutes===5) expect(paused.roundEndsAt).toBe(originalDeadline);
  else expect(paused.roundPausedRemainingMs).toBe(h.round().remainingMs);
  h.providers[0]!.onClose("completed");await h.tick(1200);
  h.providers[1]!.onMessage({frame:"AwQ="});
  expect(h.round().id).toBe(ep.episodeId);
  expect((await h.phone()).roundEndsAt).toBe(h.round().deadline);
  if (minutes===5) expect(h.round().deadline).toBe(originalDeadline);
  else expect(h.round().deadline).toBeGreaterThan(originalDeadline);
  expect(h.bus.history({types:["episode.started"]})).toHaveLength(1);
  await h.end();h.providers[1]!.onClose("completed");
  expect(h.bus.history({types:["episode.ended"]})).toHaveLength(1);
  expect((await h.phone()).episodeActive).toBe(false);
});

it("rejects the 600000ms single-session diagnostic before processing a seed or launching a provider",async()=>{
  vi.stubEnv("PG_REHEARSAL_LIVE_MS","600000");
  const h=await world();
  expect((await h.start()).statusCode).toBe(400);
  expect(h.review).not.toHaveBeenCalled();
  expect(h.providers).toHaveLength(0);
  expect(h.bus.history({types:["episode.started"]})).toHaveLength(0);
  expect((await h.start(10)).statusCode).toBe(200);
});

it("closes and drains a provider if the real bus rejects the first native frame's start",async()=>{
  const h=await world(true);
  expect((await h.start(10)).statusCode).toBe(200);
  await h.tick(150);
  const p=h.providers[0]!;
  expect(()=>p.onMessage({frame:"AQI="})).not.toThrow();
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(h.round()).toMatchObject({phase:"ended",reason:"interrupted",winner:null,startedAt:null});
  expect((await h.state()).providerClosing).toBe(true);
  expect((await h.start()).statusCode).toBe(409);
  p.onMessage({winner:"audience"});
  p.onClose("canceled");
  expect((await h.state()).providerClosing).toBe(false);
  expect(h.round().terminal).toBe("canceled");
  expect(h.bus.history({types:["episode.started","episode.ended"]})).toHaveLength(0);
});

it("closes an accepted episode once if a live subscriber throws",async()=>{
  const h=await world();
  h.bus.subscribe(["episode.started"],()=>{throw Error("subscriber unavailable");});
  await h.start(10);await h.tick(150);
  const p=h.providers[0]!;
  expect(()=>p.onMessage({frame:"AQI="})).not.toThrow();
  p.onClose("completed");
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(h.bus.history({types:["episode.started","episode.ended"]}).map(e=>e.type)).toEqual(["episode.started","episode.ended"]);
});

it("keeps a filmed audience pick pending through collection and blackout, acknowledges it at actual clip playback, and ends at five minutes", async () => {
  const {buildPreparedLibrary}=await import(resolve(__dirname,"../../world/rehearsal/prepared-show.mjs"));
  const take={role:"effect",id:"fixture-response",file:"fixture-response.mp4",presetId:"mop-bucket",title:"A rolling bucket",
    frames:120,durationMs:5000,sha256:"c".repeat(64),source:{episodeId:"fixture-episode"}};
  const receipt={verifiedInPixels:true,episodeId:take.source.episodeId,clipSha256:take.sha256,action:"sidestep",obstacleFrame:36,responseFrame:75};
  const library=buildPreparedLibrary([{role:"walk",file:"fixture-walk.mp4",durationMs:6000},
    {role:"idle",file:"fixture-idle.mp4",durationMs:6000},take,{...take,file:"fixture-response-verified.mp4",reactionEvidence:receipt}]);
  const h = await world(false,library);
  const startedAt = Date.now();
  expect((await h.post("/rehearsal/start", {mode:"prepared"})).statusCode).toBe(200);
  const join = await h.app.inject("/api/crowd/state");
  const cookie = String(join.headers["set-cookie"]).split(";")[0]!;
  const state = async () => (await h.app.inject({method:"GET", url:"/api/crowd/state", headers:{cookie}})).json();
  expect(join.headers["x-pg-catalog"]).toContain("filmed:");
  expect((await state()).roundEndsAt).toBe(startedAt + 300000);
  await h.app.inject({method:"POST", url:"/api/crowd/haunt", headers:{cookie}, payload:{preset:"mop-bucket"}});
  await h.tick(24000);
  expect((await state()).mine[0].status).toBe("queued");
  expect((await state()).upNext).toBeUndefined();
  await h.tick(3000);
  expect((await state()).mine[0].status).toBe("dispatched");
  await h.tick(3200);
  expect(h.round().prepared.phase).toBe("handoff");
  expect((await state()).mine[0].status).toBe("dispatched");
  await h.tick(1600);
  expect(h.round().prepared.clipUrl).toContain("fixture-response-verified.mp4");
  expect((await state()).mine[0].status).toBe("injected");
  expect(h.bus.history({types:["haunt.dispatch","haunt.injected"]}).map(e=>e.type)).toEqual(["haunt.dispatch","haunt.injected"]);
  await h.tick(300000 - (Date.now()-startedAt) + 150);
  expect((await state()).episodeActive).toBe(false);
  expect(h.providers).toHaveLength(0);
  expect(h.review).not.toHaveBeenCalled();
});


it("refuses a screening with no verified library entry before publishing a round or opening a provider", async()=>{
  const {buildPreparedLibrary}=await import(resolve(__dirname,"../../world/rehearsal/prepared-show.mjs"));
  const h=await world(false,buildPreparedLibrary([]));
  const start=await h.post("/rehearsal/start",{mode:"prepared"});
  expect(start.statusCode).toBe(409);
  expect(start.json().error).toMatch(/verified robot response/);
  expect(h.providers).toHaveLength(0);
  expect(h.bus.history({types:["episode.started"]})).toHaveLength(0);
});

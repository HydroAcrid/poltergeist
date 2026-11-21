import { afterEach, expect, it, vi } from "vitest";
import fastify from "fastify";
import { resolve, sep } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
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

type BufferedInput = {picks: {id:string,text:string,by:string}[], seed:Buffer, signal:AbortSignal, chapter:number, continuation:boolean};
async function world(badId = false, library?: unknown, renderBuffered?: (input: BufferedInput) => Promise<unknown>) {
  vi.useFakeTimers({toFake:["Date","setInterval","clearInterval"]});
  const app = fastify(); hosts.push(app);
  const bus = new MemoryBus();
  const providers: Provider[] = [], stop = vi.fn(), review = vi.fn(async () => ({passes:true}));
  const path = resolve(__dirname,"../../world/rehearsal/server.mjs");
  const {registerStage} = await import(path);
  const root = resolve(__dirname,"../../world/rehearsal");
  const round = await registerStage(app,{
    bus,root,library,captureDir:root,...(renderBuffered && {renderBuffered,canEncode:()=>true,generatePlate:async ({photo}:{photo:Buffer})=>({bytes:photo,mime:"image/jpeg"})}),chapterTiming:{matchMs:600_000,cutMs:3000,limitMs:90_000},reviewSeed:review,makePilot:()=>()=>({action:{key:"NOOP"}}),
    newId:()=>badId ? "invalid-episode" : newId("ep"),
    launchLive:(provider:Provider)=>{providers.push(provider);return {stop,send:vi.fn()};},
  });
  const crowd = createCrowdModule({lobbyPhase:round.lobbyPhase,prepared:round.prepared,renderWindow:round.renderWindow,matchClock:()=>{
    const r=round();return (r?.chapters || r?.playMode === "prepared-show" || r?.playMode === "buffered-live") && ["playing","handoff"].includes(r.phase) ? r : undefined;
  },config:{firstDispatchMs:1200,roundEveryMs:null,seededFallback:false}});
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

it("keeps a filmed audience pick pending through collection and blackout, acknowledges it at actual clip playback, and ends at five minutes", async ({onTestFinished}) => {
  const {buildPreparedLibrary}=await import(resolve(__dirname,"../../world/rehearsal/prepared-show.mjs"));
  const fixtureDir=mkdtempSync(resolve(tmpdir(),"pg-screening-test-"));
  onTestFinished(()=>rmSync(fixtureDir,{recursive:true,force:true}));
  const bytes=Buffer.from("Test clip bytes used to verify the audience receipt clock");
  writeFileSync(resolve(fixtureDir,"fixture-response-verified.mp4"),bytes);
  writeFileSync(resolve(fixtureDir,"fixture-walk.mp4"),bytes);
  const take={role:"effect",id:"fixture-response",file:"fixture-response.mp4",verifiedScare:true,presetId:"mop-bucket",title:"A rolling bucket",
    frames:120,fps:24,durationMs:5000,sha256:createHash("sha256").update(bytes).digest("hex"),source:{episodeId:"fixture-episode"}};
  const receipt={verifiedInPixels:true,episodeId:take.source.episodeId,clipSha256:take.sha256,action:"recoil",obstacleFrame:36,responseFrame:75};
  const library=buildPreparedLibrary([{role:"walk",file:"fixture-walk.mp4",durationMs:6000,sha256:take.sha256},
    {role:"idle",file:"fixture-idle.mp4",durationMs:6000},take,{...take,file:"fixture-response-verified.mp4",reactionEvidence:receipt}],pathToFileURL(fixtureDir+sep));
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
  expect(h.round().prepared.clipUrl).toContain("fixture-walk.mp4");
  expect((await state()).mine[0].status).toBe("dispatched");
  await h.tick(7350);
  expect(h.round().prepared.clipUrl).toContain("fixture-response-verified.mp4");
  expect((await state()).mine[0].status).toBe("dispatched");
  await h.tick(1700);
  expect((await state()).mine[0].status).toBe("injected");
  expect(h.round().fear).toBe(0);
  await h.tick(1800);
  expect(h.round().fear).toBe(1);
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

it("keeps two guests submitting during live filming and starts five minutes only on the host’s separate Start", async () => {
  const renders: Array<{input:BufferedInput,finish:()=>void}> = [];
  const renderer = (input: BufferedInput) => new Promise((resolve,reject) => {
    const last = Buffer.from("native-final-"+input.chapter);
    const obs = (frame:number) => ({frame,playerCount:1,visible:true,subjectTracked:true,feetVisible:true,shoulderView:'rear-right'});
    renders.push({input,finish:()=>resolve({filePath:"/tmp/episode-"+input.chapter+".mp4",finalFrame:last,
      durationMs:12000,fps:24,frameCount:288,evidence:{continuity:{matches:true},finalFear:0,
        picks:input.picks.map(p=>({id:p.id,delivered:true,visible:true,inPath:true,inPathFrame:25,inPathOffsetMs:1000,
          reacted:true,reactedFrame:65,reactedOffsetMs:2667,reaction:'sidestep',response:{basis:25,appliedFrame:35,checkedFrame:65,key:'D',outcome:'route-open'}})),
        observations:[obs(1),obs(25),obs(65),obs(280)],moves:[{observed:25,appliedFrame:35,key:'D'}]}})});
    input.signal.addEventListener("abort",()=>reject(Error("Round closed")),{once:true});
  });
  const h=await world(false,undefined,renderer);
  const open=()=>h.post("/rehearsal/start",{mode:"buffered",expectedPlayMode:"buffered-live",useVenueOpening:true});
  expect((await open()).statusCode).toBe(200);
  const id=h.round().id;
  const play=()=>h.post("/rehearsal/play",{round:id});
  expect((await play()).statusCode).toBe(409);
  const join=async()=>String((await h.app.inject("/api/crowd/state")).headers["set-cookie"]).split(";")[0]!;
  const guests=[await join(),await join()];
  expect(guests[0]).not.toBe(guests[1]);
  const submits=await Promise.all(["lights-flicker","mop-bucket"].map((preset,i)=>h.app.inject({
    method:"POST",url:"/api/crowd/haunt",headers:{cookie:guests[i]!},payload:{preset}
  })));
  const ids=submits.map(r=>r.json().hauntId);
  expect(new Set(ids).size).toBe(2);
  await h.tick(5000);
  expect(renders).toHaveLength(1);
  const first=renders[0]!.input;
  expect(first.chapter).toBe(1);expect(first.continuation).toBe(false);
  expect(first.picks).toHaveLength(1);
  expect(createHash("sha256").update(first.seed).digest("hex")).toBe("7a47d68c3cc99e78ebc2ab3eebc3a162e6b1983e148f83b619d86ed4f787c755");
  expect(h.round().prepared.preload).toEqual([]);
  renders[0]!.finish();await h.tick(45000);
  expect((await play()).statusCode).toBe(409);
  expect(renders[1]!.input.seed.equals(Buffer.from("native-final-1"))).toBe(true);
  expect(new Set([...first.picks,...renders[1]!.input.picks].map(p=>p.id))).toEqual(new Set(ids));
  renders[1]!.finish();await h.tick(300000);
  expect(h.round()).toMatchObject({phase:"preparing",startedAt:null,deadline:null,remainingMs:300000,prepared:{canStart:true}});
  expect((await h.phone()).roundEndsAt).toBeUndefined();
  expect((await h.phone()).lobbyPhase).toBe("lobby");
  expect(h.bus.history({types:["haunt.injected"]})).toHaveLength(0);
  const expected=Date.now()+300000;
  expect((await play()).json().deadline).toBe(expected);
  expect((await play()).json().deadline).toBe(expected);
  expect((await h.phone()).roundEndsAt).toBe(expected);
  await h.tick(1500);
  expect(h.round().prepared.clipUrl).toBe("/rehearsal/segments/"+id+"/1.mp4");
  expect(renders).toHaveLength(2);
  await h.tick(1200);
  expect(h.bus.history({types:["haunt.injected"]})).toHaveLength(1);
  const extra=await h.app.inject({method:"POST",url:"/api/crowd/haunt",headers:{cookie:guests[0]!},payload:{preset:"painted-door"}});
  await h.tick(3500);
  expect(renders[2]!.input.seed.equals(Buffer.from("native-final-2"))).toBe(true);
  expect(renders[2]!.input.picks.map(p=>p.id)).toEqual([extra.json().hauntId]);
  await h.end();await h.tick(150);
  expect((await open()).statusCode).toBe(200);
  expect(h.round().id).not.toBe(id);
  expect(h.round().prepared.preload).toEqual([]);
  expect((await h.end()).json().phase).toBe("ended");
  expect((await h.phone()).episodeActive).toBe(false);
  expect(h.bus.history({types:["episode.ended"]}).at(-1)!.payload).toMatchObject({durationMs:0});
});

it("begins a custom-photo lobby on the uploaded room seed and leaves phones open when the provider needs a retry",async()=>{
  const seen:BufferedInput[]=[];
  const h=await world(false,undefined,async input=>{seen.push(input);throw Error("offline");});
  const photo=readFileSync(resolve(__dirname,"../../world/painted-door/haunting/fixtures/clear-aisle.jpg"));
  const upload=await h.app.inject({method:"POST",url:"/rehearsal/photo",headers:{"x-show-control":"1","content-type":"image/jpeg"},payload:photo});
  expect(upload.statusCode).toBe(200);
  await h.tick(150);
  const state=await h.state();
  expect(state).toMatchObject({plateReady:true,custom:true,approvedVenueOpening:false});
  expect((await h.post("/rehearsal/start",{mode:"buffered",useVenueOpening:true,plateKey:state.plateKey})).statusCode).toBe(409);
  expect((await h.post("/rehearsal/start",{mode:"buffered",seed:photo.toString("base64"),plateKey:state.plateKey})).statusCode).toBe(200);
  async function sendGuest(preset:string) {
    const cookie=String((await h.app.inject("/api/crowd/state")).headers["set-cookie"]).split(";")[0]!;
    return (await h.app.inject({method:"POST",url:"/api/crowd/haunt",headers:{cookie},payload:{preset}})).json();
  }
  await sendGuest("mop-bucket");await h.tick(5000);
  expect(seen[0]!.seed.equals(photo)).toBe(true);
  expect(h.round().prepared).toMatchObject({renderPaused:true,canStart:false,preload:[]});
  await h.tick(305000);
  expect((await sendGuest("lights-flicker")).hauntId).toBeTruthy();
  expect((await h.phone()).lobbyPhase).toBe("lobby");
  expect(seen).toHaveLength(1);
  expect((await h.post("/rehearsal/retry-render",{round:"stale"})).statusCode).toBe(409);
  expect((await h.post("/rehearsal/retry-render",{round:h.round().id})).statusCode).toBe(200);
  await h.tick(1000);expect(seen).toHaveLength(2);
  expect(seen[1]!.picks[0]!.id).toBe(seen[0]!.picks[0]!.id);
  expect((await h.end()).json().phase).toBe("ended");
});

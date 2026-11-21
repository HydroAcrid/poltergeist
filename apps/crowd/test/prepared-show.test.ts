import { afterEach, expect, it, vi } from "vitest";
import { buildTestHub, type TestHub } from "./hub.js";
import { loadPresets } from "../server/load.js";
import { RulesOnlyModeration } from "../server/moderation/rules.js";
import type { PreparedWindow, RenderWindow } from "../server/prepared.js";
import type { MatchClock } from "../server/crowd.js";

const options = loadPresets().filter(p => ["chair-tips", "mop-bucket", "paper-gust"].includes(p.id))
  .map(p => ({...p, title: p.label}));
let hub: TestHub;
afterEach(async () => {vi.restoreAllMocks(); await hub?.close();});

async function phone() {
  const first = await hub.app.inject({method:"GET", url:"/api/crowd/state"});
  const headers = {cookie:String(first.headers["set-cookie"]).split(";")[0]!};
  return {
    state:async () => (await hub.app.inject({method:"GET", url:"/api/crowd/state", headers})).json(),
    post:async (payload: object) => {
      const result = await hub.app.inject({method:"POST",url:"/api/crowd/haunt",headers,payload});
      expect(result.statusCode).toBe(200);
      return result.json().hauntId;
    },
  };
}

it("rechecks the lobby and gives a private one-tap filmed revision without calling a model", async () => {
  let window: PreparedWindow | null = null;
  hub = await buildTestHub({prepared: () => window});
  const a = await phone(), b = await phone(), c = await phone();
  const storm = await a.post({preset:"fog"});
  const oldList = await hub.app.inject({method:"GET",url:"/api/crowd/state?waitingPage=0"});
  window = {options,canDispatch:false};
  const poll = await hub.app.inject({method:"GET",url:"/api/crowd/state?waitingPage=0",
    headers:{"if-none-match":String(oldList.headers.etag),cookie:String(oldList.headers["set-cookie"]).split(";")[0]!}});
  expect(poll.headers["x-pg-catalog"]).toContain("filmed:");
  expect((await hub.app.inject({method:"GET",url:"/api/crowd/presets"})).json().map((p: {id:string}) => p.id)).toEqual(options.map(o=>o.id));
  const model = vi.spyOn(RulesOnlyModeration.prototype, "moderate");
  hub.world.startEpisode(); hub.crowd.tick();
  expect((await a.state()).mine[0]).toMatchObject({hauntId:storm,status:"rejected",moderated:{model:"filmed",text:""}});
  const id = await b.post({text:"A hurricane blows down the hallway"});
  const receipt = (await b.state()).mine[0];
  const wind = options.find(o => o.id === "paper-gust")!;
  expect(receipt).toMatchObject({hauntId:id,status:"rejected",moderated:{suggestion:wind.text}});
  expect((await c.state()).queue).toHaveLength(0);
  const revised = await b.post({text:receipt.moderated.suggestion,revisionOf:id});
  expect(await b.post({text:receipt.moderated.suggestion,revisionOf:id})).toBe(revised);
  expect((await b.state()).queue[0]).toMatchObject({hauntId:revised,preset:wind.id,moderated:{text:wind.text}});
  await c.post({text:"<ATTENDEE_NAME> trips on a bucket"});
  expect((await c.state()).mine[0].moderated).toMatchObject({safe:false,text:"",reason:"Keep it about the hallway, not people."});
  expect(model).not.toHaveBeenCalled();
});

it("collects 30 independent choices then selects the crowd favourite with the five-minute World clock", async () => {
  const film = {options,canDispatch:false};
  let clock: MatchClock | undefined;
  hub = await buildTestHub({prepared:()=>film, matchClock:()=>clock});
  const start = hub.clock.now(), deadline = start + 300000;
  const id = hub.world.startEpisode({match:{clockMode:"wall", durationMs:300000, deadline}});
  clock = {id,durationMs:300000,deadline,phase:"playing",clockMode:"wall",remainingMs:300000};
  const wind = options.find(o => o.id === "paper-gust")!;
  for (let i=0; i<30; i++) {
    await (await phone()).post({preset:i < 2 ? "mop-bucket" : i < 5 ? "chair-tips" : "paper-gust"});
    hub.crowd.tick();
    hub.clock.advance(500);
  }
  expect(hub.dispatched()).toEqual([]);
  expect(hub.crowd.state("observer")).toMatchObject({roundEndsAt:deadline});
  expect(hub.crowd.state("observer").upNext).toBeUndefined();
  const unsubscribe = hub.bus.subscribe(["haunt.dispatch"], () => {film.canDispatch = false;hub.crowd.tick();});
  film.canDispatch = true;hub.crowd.tick();hub.crowd.tick();
  expect(hub.dispatched()).toHaveLength(1);
  expect(hub.dispatched()[0]).toMatchObject({text:wind.text,episodeId:id});
  expect(hub.crowd.state("observer").hallway?.[0]?.status).toBe("dispatched");
  await hub.world.flush();
  expect(hub.crowd.state("observer").hallway?.[0]?.status).toBe("injected");
  hub.clock.advance(300000);film.canDispatch=true;hub.crowd.tick();
  expect(hub.dispatched()).toHaveLength(1);
  unsubscribe();
});

it("admits separate moderated ideas one tick apart while a buffered generation window has capacity", async () => {
  const gate: RenderWindow = {canDispatch:false,slots:2};
  hub = await buildTestHub({renderWindow:()=>gate, config:{firstDispatchMs:0,intervalMs:12000}});
  hub.world.startEpisode();
  const a = await phone(), b = await phone(), c = await phone();
  const model = vi.spyOn(RulesOnlyModeration.prototype, "moderate");
  await a.post({text:"A chair falls into the aisle"});
  await b.post({text:"A puff of fog rolls in"});
  await c.post({text:"Paper gusts through the hall"});
  await hub.crowd.whenIdle();hub.crowd.tick();
  expect(model).toHaveBeenCalledTimes(3);expect(hub.dispatched()).toHaveLength(0);
  expect((await a.state()).upNext).toBeUndefined();
  const unsubscribe = hub.bus.subscribe(["haunt.dispatch"], () => {gate.slots--;});
  gate.canDispatch = true;hub.crowd.tick();
  hub.clock.advance(250);hub.crowd.tick();hub.crowd.tick();
  expect(hub.dispatched()).toHaveLength(2);
  expect(hub.crowd.state("observer").hallway?.map(h=>h.status)).toEqual(["dispatched","dispatched"]);
  expect(hub.crowd.state("observer").upNext).toBeUndefined();
  await hub.world.flush();
  expect(hub.crowd.state("observer").hallway?.map(h=>h.status)).toEqual(["injected","injected"]);
  unsubscribe();
});

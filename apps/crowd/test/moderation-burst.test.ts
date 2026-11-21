import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { MemoryBus } from "../dev/memory-bus.js";
import type { CrowdService } from "../server/crowd.js";
import { createCrowdModule } from "../server/index.js";
import { GeminiModeration } from "../server/moderation/gemini.js";

const accepted = (text: string) => Response.json({
  candidates: [{content:{parts:[{text:JSON.stringify({decision:"accept",text,tags:["distractor"]})}]}}],
});

describe("custom idea moderation under audience load", () => {
  it("issues 300 private receipts immediately, limits parallel work, and recovers a throttled idea", async () => {
    let inflight=0, peak=0, release!: () => void;
    const paused=new Promise<void>(done => {release=done;});
    const attempts=new Map<string,number>();
    const request=vi.fn<typeof fetch>(async (_url, init) => {
      const content=JSON.parse(String(init?.body)).contents[0].parts[0].text;
      const {idea}=JSON.parse(content) as {idea:string};
      const count=(attempts.get(idea) ?? 0)+1;
      attempts.set(idea,count);
      peak=Math.max(peak,++inflight);
      try {
        await paused;
        if (idea.endsWith(" 8")) return new Response(null,{status:503});
        if (idea.endsWith(" 7") && count===1) return new Response(null,{status:429,headers:{"retry-after":"0"}});
        return accepted(idea);
      } finally {inflight--;}
    });
    vi.stubGlobal("fetch",request);
    const app=Fastify();
    let crowd!: CrowdService;
    const module=createCrowdModule({autoTick:false,onService:value=>{crowd=value;}});
    try {
      await module.register(app,{bus:new MemoryBus(Date.now),dataDir:"./data-test",instance:"local",
        env:{GEMINI_API_KEY:"fixture",PG_MODERATION_CONCURRENCY:"3"},log() {}});
      await app.ready();
      const post=(payload: object,cookie?:string) => app.inject({method:"POST",url:"/api/crowd/haunt",
        headers:cookie?{cookie}:{},payload});
      const receipts=await Promise.all(Array.from({length:300},(_,i)=>post({text:"A toy penguin rolls by marker "+i})));
      expect(receipts.every(r=>r.statusCode===200 && r.json().status==="submitted")).toBe(true);
      expect(new Set(receipts.map(r=>r.json().hauntId)).size).toBe(300);
      expect(attempts.size).toBe(3);
      expect(crowd.eligible()).toHaveLength(0);
      const preset=await post({preset:"banana-peel"});
      expect(preset.statusCode).toBe(200);
      expect(crowd.eligible()).toHaveLength(1);
      expect(attempts.size).toBe(3);
      release();
      await crowd.whenIdle();
      expect(peak).toBe(3);
      expect(inflight).toBe(0);
      expect(request).toHaveBeenCalledTimes(301);
      expect(crowd.eligible()).toHaveLength(300); // 299 checked custom ideas and the preset
      expect(attempts.get("A toy penguin rolls by marker 7")).toBe(2);
      const failed=receipts[8]!;
      const cookie=String(failed.headers["set-cookie"]).split(";")[0]!;
      const state=await app.inject({method:"GET",url:"/api/crowd/state?waitingPage=0",headers:{cookie}});
      const mine=state.json().mine[0];
      expect(mine.status).toBe("rejected");
      expect(mine.moderated.safe).toBe(false);
      expect(mine.moderated.suggestion).toBeTruthy();
      const revision=await post({revisionOf:mine.hauntId,text:mine.moderated.suggestion},cookie);
      expect(revision.statusCode).toBe(200);
      await crowd.whenIdle();
      expect(crowd.eligible()).toHaveLength(301);
    } finally {
      release();
      await module.close?.();
      await app.close();
      vi.unstubAllGlobals();
    }
  });

  it.each(["header","google-detail"])("respects a shared 429 cooldown from %s", async style => {
    vi.useFakeTimers();
    try {
      const calls: number[]=[];
      const request=vi.fn<typeof fetch>(async () => {
        const call=calls.push(Date.now());
        if (call===2) await new Promise(done=>setTimeout(done,100));
        if (call>1) return accepted("Papers roll across the aisle");
        if (style==="header") return new Response(null,{status:429,headers:{"retry-after":"2"}});
        return Response.json({error:{details:[{"@type":"type.googleapis.com/google.rpc.RetryInfo",retryDelay:"2s"}]}},{status:429});
      });
      const adapter=new GeminiModeration("fixture","fixture",request,undefined,2);
      const pending=Promise.all(["A paper crab","A paper kite","A paper boat"].map(idea=>adapter.moderate(idea)));
      await vi.advanceTimersByTimeAsync(1999);
      // The second slot finished at 100ms. The third job must still observe the first job's cooldown.
      expect(request).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).every(answer=>answer.safe)).toBe(true);
      expect(calls.slice(2).map(t=>t-calls[0]!)).toEqual([2000,2000]);
    } finally {vi.useRealTimers();}
  });
});

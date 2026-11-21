// Brain's HTTP surface (CONTRACTS C17): POST /api/brain/tick and GET /api/brain/policy.
// Standalone for now; World's hub will mount the same routes via LaneModule.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { TickLog, type Reaction } from "@poltergeist/contracts/tick-log.js";
import { TickRequest } from "@poltergeist/contracts/tick-request.js";
import type { TickResponse } from "@poltergeist/contracts/tick-response.js";
import type { TickHandler } from "./tick.js";

export interface BrainServerOptions {
  handler: TickHandler;
  dataDir: string;
  policy: { version: string; yaml: string };
  perception: string;
  log?: boolean;
}

const error = (code: string, message: string) => ({ error: { code, message } });

/** After responding (C17 step 5): write the frame and append the TickLog. */
function recordTick(dataDir: string, req: TickRequest, res: TickResponse, reaction?: Reaction): void {
  const dir = join(dataDir, "episodes", req.episodeId);
  const framePath = join("data", "episodes", req.episodeId, "frames", `${req.seq}.jpg`).replaceAll("\\", "/");
  mkdirSync(join(dir, "frames"), { recursive: true });
  writeFileSync(join(dir, "frames", `${req.seq}.jpg`), Buffer.from(req.frame.b64, "base64"));
  const log = TickLog.parse({
    episodeId: req.episodeId,
    seq: req.seq,
    t: req.t,
    driver: req.driver,
    framePath,
    frameDiff: req.frameDiff,
    perception: res.perception,
    action: res.action,
    mode: res.mode,
    rationale: res.rationale,
    successClaim: res.successClaim,
    policyVersion: res.policyVersion,
    ...(reaction ? { reaction } : {}),
    ...(res.decision ? { decision: res.decision } : {}),
  });
  appendFileSync(join(dir, "ticks.jsonl"), JSON.stringify(log) + "\n");
}

export function buildServer(opts: BrainServerOptions): FastifyInstance {
  const app = Fastify({ logger: opts.log ?? false, bodyLimit: 1_000_000 });

  app.get("/api/brain/health", async () => ({ ok: true, perception: opts.perception, policyVersion: opts.policy.version }));
  app.get("/api/brain/policy", async () => opts.policy);

  app.post("/api/brain/tick", async (request, reply) => {
    const parsed = TickRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(error("INVALID", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 500)));
    }
    let res: TickResponse;
    let reaction: Reaction | undefined;
    try {
      ({ response: res, reaction } = await opts.handler.decide(parsed.data));
    } catch (e) {
      return reply.code(400).send(error("INVALID", String((e as Error).message).slice(0, 200)));
    }
    reply.raw.once("finish", () => {
      try {
        recordTick(opts.dataDir, parsed.data, res, reaction);
      } catch (e) {
        app.log.error({ err: e }, "failed to record tick");
      }
    });
    return res;
  });

  return app;
}

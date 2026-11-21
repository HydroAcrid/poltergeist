// Core of POST /api/brain/tick, without HTTP: validate → perceive → control → respond.
import type { Reaction } from "@poltergeist/contracts/tick-log.js";
import { TickRequest } from "@poltergeist/contracts/tick-request.js";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";
import { initialState, step, type ControllerState } from "./controller.js";
import { stepNav } from "./navigate.js";
import { stepReact } from "./react.js";
import { buildPlayerInput, type PlayerTask } from "./perception/player-input.js";
import { resolvePerception } from "./perception/resolve.js";
import type { PerceptionAdapter, PerceptionResult } from "./perception/types.js";
import type { Policy } from "./policy.js";

export interface TickDeps {
  adapter: PerceptionAdapter;
  policy: Policy;
  /** Task for each episode, from `episode.started` (Episode.task only). */
  taskFor: (episodeId: string) => PlayerTask | undefined;
  now?: () => number;
}

export class TickHandler {
  private readonly states = new Map<string, ControllerState>();
  /** The last frame Brain received per episode, shown to the model next tick (decision mode). */
  private readonly lastFrames = new Map<string, TickRequest["frame"]>();
  constructor(private readonly deps: TickDeps) {}

  /** HTTP boundary: validate the request (C04), then decide. */
  async handle(raw: unknown): Promise<TickResponse> {
    return this.run(TickRequest.parse(raw));
  }

  /** Decide on an already-validated request. */
  async run(req: TickRequest): Promise<TickResponse> {
    return (await this.decide(req)).response;
  }

  /** Decide, and also return what only the TickLog carries (the observed reaction). */
  async decide(req: TickRequest): Promise<{ response: TickResponse; reaction?: Reaction }> {
    const now = this.deps.now ?? (() => performance.now());
    const started = now();
    const task = this.deps.taskFor(req.episodeId);
    if (!task) throw new Error(`no task for episode ${req.episodeId}`);

    const { policy, adapter } = this.deps;
    const modelDecides = policy.decision.mode === "model";
    const input = buildPlayerInput(req, task, modelDecides ? this.lastFrames.get(req.episodeId) : undefined);
    const result = await withTimeout(
      (signal) =>
        adapter.perceive(input, {
          timeoutMs: policy.perception.timeoutMs,
          promptAddenda: policy.perception.promptAddenda,
          thinking: policy.perception.thinking,
          decide: modelDecides,
          signal,
        }),
      policy.perception.timeoutMs,
      adapter.name,
    );

    const seen = resolvePerception(result);
    const prev = this.states.get(req.episodeId) ?? initialState();
    const ctl =
      seen.scene && modelDecides && result.decision
        ? stepReact(prev, seen.scene, result.decision, req, policy)
        : seen.scene
          ? stepNav(prev, seen.scene, req, policy)
          : step(prev, seen, req, policy);
    this.states.set(req.episodeId, ctl.state);
    if (modelDecides) this.lastFrames.set(req.episodeId, req.frame);

    const response = TickResponse.parse({
      episodeId: req.episodeId,
      seq: req.seq,
      t: req.t,
      perception: seen.perception,
      action: ctl.action,
      mode: ctl.mode,
      rationale: ctl.rationale,
      successClaim: ctl.successClaim,
      policyVersion: policy.version,
      brainLatencyMs: Math.round(now() - started),
      ...(ctl.decision ? { decision: ctl.decision } : {}),
    });
    return ctl.reaction ? { response, reaction: ctl.reaction } : { response };
  }

  reset(episodeId: string): void {
    this.states.delete(episodeId);
    this.lastFrames.delete(episodeId);
  }
}

async function withTimeout(
  run: (signal: AbortSignal) => Promise<PerceptionResult>,
  timeoutMs: number,
  model: string,
): Promise<PerceptionResult> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PerceptionResult>((resolveTimeout) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolveTimeout({ visible: false, conf: 0, hazards: [], model, latencyMs: timeoutMs, error: "timeout" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      run(ctrl.signal).catch((): PerceptionResult => ({ visible: false, conf: 0, hazards: [], model, latencyMs: 0, error: "api" })),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

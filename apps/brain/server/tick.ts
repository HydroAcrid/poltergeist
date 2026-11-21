// Core of POST /api/brain/tick, without HTTP: validate → perceive → control → respond.
import { TickRequest } from "@poltergeist/contracts/tick-request.js";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";
import { initialState, step, type ControllerState } from "./controller.js";
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
  constructor(private readonly deps: TickDeps) {}

  async handle(raw: unknown): Promise<TickResponse> {
    const now = this.deps.now ?? (() => performance.now());
    const started = now();
    const req = TickRequest.parse(raw);
    const task = this.deps.taskFor(req.episodeId);
    if (!task) throw new Error(`no task for episode ${req.episodeId}`);

    const { policy, adapter } = this.deps;
    const input = buildPlayerInput(req, task);
    const result = await withTimeout(
      (signal) => adapter.perceive(input, { timeoutMs: policy.perception.timeoutMs, promptAddenda: policy.perception.promptAddenda, signal }),
      policy.perception.timeoutMs,
      adapter.name,
    );

    const seen = resolvePerception(result);
    const ctl = step(this.states.get(req.episodeId) ?? initialState(), seen, req, policy);
    this.states.set(req.episodeId, ctl.state);

    return TickResponse.parse({
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
    });
  }

  reset(episodeId: string): void {
    this.states.delete(episodeId);
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

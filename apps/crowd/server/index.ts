// Real crowd LaneModule (CONTRACTS C18). The hub picks it with PG_CROWD=real.
import type { HubContext, LaneModule } from "@poltergeist/contracts/hub-types.js";
import { configFromEnv, CrowdService, type CrowdConfig, type CrowdDeps } from "./crowd.js";
import { HAUNT_PAGE, loadPresets, loadSeededPool, OVERLAY_MODEL, OVERLAY_PAGE, VEIL_DIR } from "./load.js";
import { GeminiModeration } from "./moderation/gemini.js";
import { RulesOnlyModeration } from "./moderation/rules.js";
import { loadCrowdGeminiKeys } from "./moderation/keys.js";
import { GeminiConductorAgent, type ConductorAgent } from "./conductor-agent.js";
import type { SceneObservation } from "./conductor.js";
import { createRehearsalSceneSource } from "./scene.js";
import type { ModerationAdapter } from "./moderation/types.js";
import { registerCrowdRoutes } from "./routes.js";

export interface CrowdModuleOptions {
  now?: () => number;
  /** Run the scheduler on a timer (default). Tests call service.tick() themselves. */
  autoTick?: boolean;
  config?: Partial<CrowdConfig>;
  onService?: (service: CrowdService) => void;
  /** Scene for the conductor; defaults to polling PG_CROWD_SCENE_URL (World's /rehearsal/state) if set. */
  scene?: () => SceneObservation | undefined;
  conductorAgent?: ConductorAgent;
  lobbyPhase?: CrowdDeps["lobbyPhase"];
  matchClock?: CrowdDeps["matchClock"];
}

function pickGeminiServices(ctx: HubContext): { moderation: ModerationAdapter; conductorAgent?: ConductorAgent } {
  const { keys, source } = loadCrowdGeminiKeys(ctx.env, (msg) => ctx.log("crowd", msg));
  const mode = ctx.env.PG_MODERATION_ADAPTER ?? (keys.length ? "hydrogen" : "rules-only");
  if (mode === "rules-only") return { moderation: new RulesOnlyModeration() };
  if (mode !== "hydrogen") throw Error("Unknown moderation adapter: " + mode);
  const model = ctx.env.PG_MODEL_MODERATION || "gemini-4-hydrogen";
  // Logs how many keys and where from, never the keys themselves.
  ctx.log("crowd", `Gemini moderation on with ${keys.length} key(s) from ${source}`);
  const maxPerMinute = Number(ctx.env.PG_CROWD_GEMINI_MAX_PER_MIN) || undefined;
  const concurrency = Number(ctx.env.PG_MODERATION_CONCURRENCY || 4);
  const moderation = new GeminiModeration(
    keys,
    model,
    fetch,
    (fault) => ctx.log("crowd", fault),
    { maxPerMinute, concurrency },
  );
  // Enable the Gemini show-conductor agent when Crowd's own keys are configured (or PG_CONDUCTOR_AGENT=1).
  const wantConductor =
    ctx.env.PG_CONDUCTOR_AGENT === "1" ||
    (ctx.env.PG_CONDUCTOR_AGENT !== "0" && keys.length > 0 && (source === "private file" || source === "environment"));
  const conductorAgent = wantConductor
    ? new GeminiConductorAgent(keys, model, fetch, (fault) => ctx.log("crowd", fault))
    : undefined;
  if (conductorAgent) ctx.log("crowd", `Gemini conductor agent on (${model})`);
  return { moderation, ...(conductorAgent ? { conductorAgent } : {}) };
}

export function createCrowdModule(opts: CrowdModuleOptions = {}): LaneModule {
  let service: CrowdService | null = null;
  let sceneSource: ReturnType<typeof createRehearsalSceneSource> | null = null;
  return {
    lane: "crowd",
    kind: "real",
    async register(app, ctx) {
      // World's rehearsal host: PG_CROWD_SCENE_URL=http://127.0.0.1:8914/rehearsal/state
      const sceneUrl = ctx.env.PG_CROWD_SCENE_URL;
      if (!opts.scene && sceneUrl) sceneSource = createRehearsalSceneSource(sceneUrl, { now: opts.now });
      const gemini = pickGeminiServices(ctx);
      service = new CrowdService({
        lobbyPhase: opts.lobbyPhase,
        matchClock: opts.matchClock,
        scene: opts.scene ?? (sceneSource ? () => sceneSource!.scene() : undefined),
        conductorAgent: opts.conductorAgent ?? gemini.conductorAgent,
        bus: ctx.bus,
        moderation: gemini.moderation,
        presets: loadPresets(),
        seededPool: loadSeededPool(),
        now: opts.now,
        config: { ...configFromEnv(ctx.env), ...opts.config },
        log: (msg, extra) => ctx.log("crowd", msg, extra),
      });
      opts.onService?.(service);
      await registerCrowdRoutes(app, service, {
        operatorToken: ctx.env.PG_OPERATOR_TOKEN || undefined,
        hauntPagePath: HAUNT_PAGE, overlayPagePath: OVERLAY_PAGE, overlayModelPath: OVERLAY_MODEL, veilDir: VEIL_DIR, publicUrl: ctx.env.PG_PUBLIC_URL || undefined,
        validateResponses: ctx.instance !== "prod",
      });
      if (opts.autoTick !== false) service.start();
    },
    async health() {
      return service ? { ok: true, detail: `queue ${service.eligible().length}` } : { ok: false, detail: "not registered" };
    },
    async close() {
      service?.stop();
      sceneSource?.stop();
    },
  };
}

export default createCrowdModule();

// Real crowd LaneModule (CONTRACTS C18). The hub picks it with PG_CROWD=real.
import type { HubContext, LaneModule } from "@poltergeist/contracts/hub-types.js";
import { configFromEnv, CrowdService, type CrowdConfig, type CrowdDeps } from "./crowd.js";
import { HAUNT_PAGE, loadPresets, loadSeededPool, OVERLAY_MODEL, OVERLAY_PAGE, VEIL_DIR } from "./load.js";
import { GeminiModeration } from "./moderation/gemini.js";
import { RulesOnlyModeration } from "./moderation/rules.js";
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
  lobbyPhase?: CrowdDeps["lobbyPhase"];
  matchClock?: CrowdDeps["matchClock"];
}

function pickModeration(ctx: HubContext): ModerationAdapter {
  const key = ctx.env.GEMINI_API_KEY ?? "";
  const mode = ctx.env.PG_MODERATION_ADAPTER ?? (key ? "hydrogen" : "rules-only");
  if (mode === "rules-only") return new RulesOnlyModeration();
  if (mode !== "hydrogen") throw Error("Unknown moderation adapter: " + mode);
  return new GeminiModeration(key, ctx.env.PG_MODEL_MODERATION || "gemini-4-hydrogen", fetch, fault => ctx.log("crowd", fault),
    Number(ctx.env.PG_MODERATION_CONCURRENCY || 4));
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
      service = new CrowdService({
        lobbyPhase: opts.lobbyPhase,
        matchClock: opts.matchClock,
        scene: opts.scene ?? (sceneSource ? () => sceneSource!.scene() : undefined),
        bus: ctx.bus,
        moderation: pickModeration(ctx),
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

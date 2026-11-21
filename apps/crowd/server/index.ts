// Real crowd LaneModule (CONTRACTS C18). The hub picks it with PG_CROWD=real.
import type { HubContext, LaneModule } from "@poltergeist/contracts/hub-types.js";
import { configFromEnv, CrowdService, type CrowdConfig } from "./crowd.js";
import { HAUNT_PAGE, loadPresets, loadSeededPool } from "./load.js";
import { RulesOnlyModeration } from "./moderation/rules.js";
import type { ModerationAdapter } from "./moderation/types.js";
import { registerCrowdRoutes } from "./routes.js";

export interface CrowdModuleOptions {
  now?: () => number;
  /** Run the scheduler on a timer (default). Tests call service.tick() themselves. */
  autoTick?: boolean;
  config?: Partial<CrowdConfig>;
  onService?: (service: CrowdService) => void;
}

function pickModeration(ctx: HubContext): ModerationAdapter {
  const wanted = ctx.env.PG_MODERATION_ADAPTER ?? "rules-only";
  if (wanted !== "rules-only") ctx.log("crowd", `moderation adapter "${wanted}" not built yet; using rules-only`);
  return new RulesOnlyModeration();
}

export function createCrowdModule(opts: CrowdModuleOptions = {}): LaneModule {
  let service: CrowdService | null = null;
  return {
    lane: "crowd",
    kind: "real",
    async register(app, ctx) {
      service = new CrowdService({
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
        hauntPagePath: HAUNT_PAGE,
        validateResponses: ctx.instance !== "prod",
      });
      if (opts.autoTick !== false) service.start();
    },
    async health() {
      return service ? { ok: true, detail: `queue ${service.eligible().length}` } : { ok: false, detail: "not registered" };
    },
    async close() {
      service?.stop();
    },
  };
}

export default createCrowdModule();

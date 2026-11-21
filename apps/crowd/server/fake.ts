// Fake crowd LaneModule (CONTRACTS §8), the hub default (PG_CROWD=fake).
// On episode.started it dispatches from seeded-pool.json at t ≥ 8 s, then every 12 s.
// On episode.ended the service's real rule publishes verdict.provisional and scoreboard.updated.
// It also mounts the real phone endpoints so /haunt works with the fakes.
import type { HubContext, LaneModule } from "@poltergeist/contracts/hub-types.js";
import { configFromEnv, CrowdService } from "./crowd.js";
import { HAUNT_PAGE, loadPresets, loadSeededPool, OVERLAY_MODEL, OVERLAY_PAGE, VEIL_DIR } from "./load.js";
import { RulesOnlyModeration } from "./moderation/rules.js";
import { registerCrowdRoutes } from "./routes.js";

export function createFakeCrowdModule(
  opts: { now?: () => number; autoTick?: boolean; onService?: (s: CrowdService) => void } = {},
): LaneModule {
  let service: CrowdService | null = null;
  const unsubs: (() => void)[] = [];
  return {
    lane: "crowd",
    kind: "fake",
    async register(app, ctx: HubContext) {
      const now = opts.now ?? Date.now;
      // Seeded only: audience ideas wait in the queue, so the fake's dispatches are predictable.
      service = new CrowdService({
        bus: ctx.bus,
        moderation: new RulesOnlyModeration(),
        presets: loadPresets(),
        seededPool: loadSeededPool(),
        now,
        config: { ...configFromEnv(ctx.env), seededFallback: true },
      });
      service.eligible = () => [];
      opts.onService?.(service);
      await registerCrowdRoutes(app, service, {
        operatorToken: ctx.env.PG_OPERATOR_TOKEN || undefined,
        hauntPagePath: HAUNT_PAGE,
        overlayPagePath: OVERLAY_PAGE,
        overlayModelPath: OVERLAY_MODEL, veilDir: VEIL_DIR,
        publicUrl: ctx.env.PG_PUBLIC_URL || undefined,
      });

      // Verdicts and scoreboard come from the real referee inside CrowdService (CONTRACTS §8:
      // "using the real rule if available").
      if (opts.autoTick !== false) service.start();
    },
    async health() {
      return { ok: service !== null, detail: "fake crowd (seeded pool)" };
    },
    async close() {
      service?.stop();
      for (const u of unsubs) u();
    },
  };
}

export default createFakeCrowdModule();

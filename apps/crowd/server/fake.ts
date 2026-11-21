// Fake crowd LaneModule (CONTRACTS §8), the hub default (PG_CROWD=fake).
// On episode.started it dispatches from seeded-pool.json at t ≥ 8 s, then every 12 s.
// On episode.ended it publishes a constant agent verdict.provisional and a scoreboard.updated.
// It also mounts the real phone endpoints so /haunt works with the fakes.
import type { Episode, EpisodeEnded } from "@poltergeist/contracts/episode.js";
import type { HubContext, LaneModule } from "@poltergeist/contracts/hub-types.js";
import { Scoreboard } from "@poltergeist/contracts/scoreboard.js";
import { Verdict } from "@poltergeist/contracts/verdict.js";
import { configFromEnv, CrowdService } from "./crowd.js";
import { HAUNT_PAGE, loadPresets, loadSeededPool } from "./load.js";
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
      await registerCrowdRoutes(app, service, { operatorToken: ctx.env.PG_OPERATOR_TOKEN || undefined, hauntPagePath: HAUNT_PAGE });

      let episodes = 0;
      let policyVersion = "v1";
      unsubs.push(
        ctx.bus.subscribe(["episode.started"], (e) => {
          policyVersion = (e.payload as Episode).policyVersion;
        }),
        ctx.bus.subscribe(["episode.ended"], (e) => {
          const ended = e.payload as EpisodeEnded;
          episodes++;
          const t = now();
          const success = ended.reason === "success_claim";
          const verdict = Verdict.parse({
            episodeId: ended.episodeId,
            stage: "provisional",
            outcome: success ? "success" : "failure",
            ...(success ? {} : { failureT: 0, blame: "agent", ruleBlame: "agent" }),
            overrodeRule: false,
            evidence: [],
            confidence: success ? 0.8 : 0.5,
            model: "rule",
            createdAt: t,
          });
          ctx.bus.publish("verdict.provisional", "crowd", verdict, ended.episodeId);
          const board = Scoreboard.parse({
            updatedAt: t,
            rounds: episodes,
            episodes,
            successes: success ? 1 : 0,
            attacks: { submitted: 0, approved: 0, injected: 0, landed: 0 },
            uniqueAttackers: 0,
            topAttackers: [],
            topTags: [],
            blame: { adversary: 0, agent: success ? 0 : 1, world: 0 },
            policy: { version: policyVersion },
            killFeed: [],
          });
          ctx.bus.publish("scoreboard.updated", "crowd", board);
        }),
      );
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

// Brain-internal policy format (policies/*.yaml). Not a cross-lane contract.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { Key } from "@poltergeist/contracts/common.js";

const ms = z.number().int().nonnegative();
const unit = z.number().min(0).max(1);

export const Policy = z.object({
  version: z.string().min(1),
  parent: z.string().nullable(),
  createdBy: z.enum(["human", "coach"]),
  rationale: z.string().max(140),
  perception: z.object({
    adapter: z.enum(["er2", "hydrogen", "neon", "fixture"]),
    thinking: z.enum(["low", "medium", "high"]),
    timeoutMs: ms.max(2900),
    promptAddenda: z.array(z.string().max(300)).max(10),
  }),
  decision: z.object({ mode: z.enum(["rules", "model"]) }),
  controller: z.object({
    emaAlpha: unit,
    maxPointJump: z.number().positive(),
    yawDeadband: unit,
    kYaw: z.number().positive(),
    kFwd: z.number().positive(),
    defaultFwdMs: ms.max(1500),
    lostTicksBeforeSearch: z.number().int().positive(),
    searchStepMs: ms.max(1500),
    searchMaxSteps: z.number().int().positive(),
    exploreFwdMs: ms.max(1500),
    stuckDiffThreshold: unit,
    stuckTicks: z.number().int().positive(),
    successBoxHeight: unit,
    successCenter: unit,
    successTicks: z.number().int().positive(),
    verifyKey: Key.exclude(["NOOP", "W", "S"]),
    verifyHoldMs: ms.min(1).max(1500),
    verifyMaxSteps: z.number().int().nonnegative(),
  }),
  navigation: z.object({
    pathHalfWidth: z.number().positive(),
    farWidthRatio: unit,
    defaultObstacleHalfWidth: z.number().positive(),
    walkMs: ms.min(1).max(1500),
    stepAsideMs: ms.min(1).max(1500),
    arriveRadius: z.number().positive(),
    headingX: z.number().min(0).max(1000),
    turnDeadband: unit,
    kTurn: z.number().positive(),
    maxTurnMs: ms.min(120).max(1500),
    preferSidestep: z.boolean(),
    sidestepWithin: unit,
    sidestepShift: z.number().positive(),
    rig: z.enum(["trail", "shoulder"]),
    shoulder: z.object({
      anchor: z.tuple([z.number().int().min(0).max(1000), z.number().int().min(0).max(1000)]),
      headingX: z.number().min(0).max(1000),
      pathHalfWidth: z.number().positive(),
      arriveRow: z.number().min(0).max(1000),
    }),
    useForwardPoint: z.boolean(),
  }),
});
export type Policy = z.infer<typeof Policy>;

const policiesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../policies");

export function parsePolicy(yamlText: string): Policy {
  return Policy.parse(parse(yamlText));
}

export function loadPolicy(version = "v1"): Policy {
  return parsePolicy(readFileSync(resolve(policiesDir, `${version}.yaml`), "utf8"));
}

/** The same policy with a different decision mode (e.g. PG_DECISION=model). */
export function withDecision(policy: Policy, mode: Policy["decision"]["mode"]): Policy {
  return { ...policy, decision: { mode } };
}

/** The same policy with a different camera rig (e.g. PG_CAMERA_RIG=shoulder). */
export function withRig(policy: Policy, rig: Policy["navigation"]["rig"]): Policy {
  return { ...policy, navigation: { ...policy.navigation, rig } };
}

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { HauntTag } from "@poltergeist/contracts/common.js";

export const fixturesDir = resolve(__dirname, "../../../fixtures");
export const loadFixture = (rel: string): unknown => JSON.parse(readFileSync(join(fixturesDir, rel), "utf8"));

export const ModerationCase = z
  .object({
    id: z.string().regex(/^mc-\d{2}$/),
    input: z.string().min(1).max(80),
    expectSafe: z.boolean(),
    expectTags: z.array(HauntTag).max(3),
    adversarial: z.boolean(),
    note: z.string(),
  })
  .strict();

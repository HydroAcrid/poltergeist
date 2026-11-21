// TEMPORARY stand-in for World's packages/contracts/src/common.ts (C01).
// World owns the real file; it is not on main yet. Crowd contract files import
// "./common.js", and tsconfig (rootDirs) and vitest (plugin) route that import
// here until World's scaffold lands. Delete this file then.
//
// Same naming as apps/brain/test/shims/contracts/common.ts: each export is a
// zod schema with a same-named inferred type. Crowd also needs Lane, Source,
// Blame, WorldMode and Instance.
import { z } from "zod";

export const Lane = z.enum(["world", "brain", "crowd"]);
export type Lane = z.infer<typeof Lane>;

export const Source = z.enum(["world", "brain", "crowd", "operator", "hub"]);
export type Source = z.infer<typeof Source>;

export const Id = z.string().regex(/^(ep|ss|ht|ev|fr)_[0-9A-HJKMNP-TV-Z]{26}$/, "prefixed ULID");
export type Id = z.infer<typeof Id>;

export const Ms = z.number().int().nonnegative();
export type Ms = z.infer<typeof Ms>;

export const EpochMs = z.number().int();
export type EpochMs = z.infer<typeof EpochMs>;

const Coord = z.number().int().min(0).max(1000);

export const Point = z.tuple([Coord, Coord]);
export type Point = z.infer<typeof Point>;

export const Box = z
  .tuple([Coord, Coord, Coord, Coord])
  .refine(([ymin, xmin, ymax, xmax]) => ymin < ymax && xmin < xmax, "ymin<ymax and xmin<xmax");
export type Box = z.infer<typeof Box>;

export const Key = z.enum(["W", "A", "S", "D", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "NOOP"]);
export type Key = z.infer<typeof Key>;

export const HauntTag = z.enum([
  "visibility", "lighting", "occlusion", "geometry", "distractor",
  "sign_change", "weather", "audio", "other",
]);
export type HauntTag = z.infer<typeof HauntTag>;

export const Blame = z.enum(["adversary", "agent", "world"]);
export type Blame = z.infer<typeof Blame>;

export const WorldMode = z.enum(["genie", "webcam", "replay"]);
export type WorldMode = z.infer<typeof WorldMode>;

export const Driver = z.enum(["brain", "human"]);
export type Driver = z.infer<typeof Driver>;

export const Instance = z.enum(["local", "staging", "prod"]);
export type Instance = z.infer<typeof Instance>;

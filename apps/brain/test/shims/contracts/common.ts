// TEMPORARY stand-in for World's packages/contracts/src/common.ts (C01).
// World owns the real file; it is not on main yet. The brain contract files
// import "./common.js", and both tsconfig (rootDirs) and vitest (alias) route
// that import here until World's scaffold lands. Delete this file then.
//
// Names assumed: each export is a zod schema with a same-named inferred type.
import { z } from "zod";

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

export const Driver = z.enum(["brain", "human"]);
export type Driver = z.infer<typeof Driver>;

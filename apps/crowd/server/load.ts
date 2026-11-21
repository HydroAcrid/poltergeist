import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Haunt, Preset } from "@poltergeist/contracts/haunt.js";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");
export const HAUNT_PAGE = resolve(here, "../web/haunt.html");
export const OVERLAY_PAGE = resolve(here, "../web/overlay.html");
export const OVERLAY_MODEL = resolve(here, "../web/overlay-model.js");

const read = (rel: string): unknown => JSON.parse(readFileSync(resolve(REPO_ROOT, rel), "utf8"));

export function loadPresets(): Preset[] {
  return z.array(Preset).parse(read("fixtures/haunt/presets.json"));
}

export function loadSeededPool(): Haunt[] {
  return z.array(Haunt).parse(read("fixtures/haunt/seeded-pool.json"));
}

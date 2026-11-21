import type { PlayerInput } from "./types.js";

/** Base perception prompt (apps/brain/CLAUDE.md) with policy addenda appended. */
export function buildPrompt(input: PlayerInput, promptAddenda: string[] = []): string {
  const base = [
    `You are the eyes of a robot in a first-person 3D world. Target: ${input.targetLabel}.`,
    `Return ONLY JSON: {"visible": boolean, "point": [y, x], "box": [ymin, xmin, ymax, xmax],`,
    `"conf": number, "hazards": [{"label": string, "point": [y, x]}]}.`,
    "Coordinates are integers normalized to 0-1000, origin top-left.",
    "If the target is not clearly visible, set visible=false and omit point and box.",
    "List at most 3 hazards that block the path to the target.",
  ];
  return [...base, ...promptAddenda].join("\n");
}

import type { Haunt, Moderated, Preset } from "@poltergeist/contracts/haunt.js";
import { familyOf } from "./conductor.js";
import { blockedReason, normalizeInput } from "./moderation/rules.js";

export type FilmedOption = Pick<Preset, "id" | "text" | "tags" | "label"> & { title: string };
export type PreparedWindow = { options: FilmedOption[]; canDispatch: boolean };
export type RenderWindow = { canDispatch: boolean; slots: number };

const normalized = (text: string) => normalizeInput(text).toLowerCase().replace(/[.!?]+$/, "").trim();
const words = (text: string) => normalized(text).split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2);
const asIdea = (text: string) => ({ text, tags: [] });

/** Only a deliberately selected option or an exact name can put filmed footage on screen. */
export function filmedVerdict(raw: string, options: FilmedOption[], preset?: string): { moderated: Moderated; option?: FilmedOption } {
  const input = normalized(raw);
  const match = preset ? options.find(o => o.id === preset)
    : options.find(o => [o.label, o.title, o.text, o.id].some(alias => normalized(alias) === input));
  if (match) return { option: match, moderated: { safe: true, text: match.text, tags: match.tags, model: "filmed" } };

  const keywords = words(raw);
  const family = familyOf(asIdea(raw));
  function relevance(option: FilmedOption) {
    const terms = new Set(words([option.id, option.label, option.title, option.text].join(" ")));
    const sameFamily = family === familyOf({ text: option.text, tags: option.tags, preset: option.id });
    return Number(sameFamily) * 3 + keywords.filter(word => terms.has(word)).length;
  }
  const closest = options.reduce<FilmedOption | undefined>((best, o) =>
    !best || relevance(o) > relevance(best) ? o : best, undefined);
  const reason = blockedReason(normalizeInput(raw)) ?? "That scene hasn’t been filmed for this show.";
  return { moderated: { safe: false, text: "", tags: [], reason, model: "filmed", ...(closest && { suggestion: closest.text }) } };
}

/** Each phone has one waiting request. Group by the exact footage it selected and give ties to the least recently played clip. */
export function filmedPick(waiting: Haunt[], options: FilmedOption[], history: Haunt[]): Haunt | undefined {
  const available = new Set(options.map(o => o.text));
  const groups = new Map<string, { first: Haunt; count: number }>();
  for (const haunt of waiting) {
    const text = haunt.moderated?.text;
    if (!text || !available.has(text)) continue;
    const group = groups.get(text);
    if (group) group.count++;
    else groups.set(text, { first: haunt, count: 1 });
  }
  const last = new Map(history.map((h, i) => [h.moderated?.text, i]));
  return [...groups.values()].sort((a, b) =>
    b.count - a.count || (last.get(a.first.moderated!.text) ?? -1) - (last.get(b.first.moderated!.text) ?? -1)
  )[0]?.first;
}

// `rules-only` moderation: a deterministic blocklist plus a world-event keyword
// check. It is the free test adapter and the fallback when the model is off.
// It never calls a model.
import type { HauntTag } from "@poltergeist/contracts/common.js";
import type { Moderated } from "@poltergeist/contracts/haunt.js";
import type { ModerationAdapter } from "./types.js";

export const REASONS = {
  length: "Keep it under 80 characters.",
  people: "Keep it about the hallway, not people.",
  violence: "No violence or weapons.",
  sexual: "Keep it family-friendly.",
  selfHarm: "Keep it family-friendly.",
  hate: "Keep it kind.",
  brand: "No brands or logos.",
  words: "No words or messages in the world.",
  injection: "Describe something that happens in the hallway.",
  notEvent: "Describe something that happens in the hallway.",
} as const;

type Rule = { re: RegExp; reason: string };

/** Checked in order; first match wins. Placeholder tokens (`<SLUR>` etc.) stand in for real content in fixtures. */
const BLOCK: Rule[] = [
  { re: /<(?:SLUR|HATE)[A-Z_]*>/, reason: REASONS.hate },
  { re: /<SELF_HARM[A-Z_]*>/, reason: REASONS.selfHarm },
  { re: /<BRAND[A-Z_]*>/, reason: REASONS.brand },
  { re: /<(?:ANY_)?TEXT[A-Z_]*>/, reason: REASONS.words },
  { re: /<[A-Z_]+>/, reason: REASONS.people }, // <CELEB_NAME>, <ATTENDEE_NAME>, …
  { re: /\b(ignore|disregard)\b.*\b(instructions?|rules?|above|previous)\b|\bsystem prompt\b|\bjailbreak\b|\bdeveloper mode\b|\byou are now\b|\bapprove this\b|\bpretend\b/i, reason: REASONS.injection },
  { re: /\b(blood\w*|gore|gory|guts|corpses?|dead bod(y|ies)|kill\w*|murder\w*|stab\w*|shoot\w*|shot|guns?|knife|knives|bombs?|explosives?|weapons?|rifles?|pistols?|swords?|axes?|bleed\w*|decapitat\w*|tortur\w*|punch\w*|beat(s|ing)? up)\b/i, reason: REASONS.violence },
  { re: /\b(naked|nude|nudity|sex\w*|porn\w*|nsfw|horny|xxx|strip(per|ping)?|boobs?|genitals?)\b/i, reason: REASONS.sexual },
  { re: /\b(suicid\w*|self[- ]?harm|overdos\w*|hang (my|him|her|them)sel(f|ves)|cut(ting)? (my|him|her)self)\b/i, reason: REASONS.selfHarm },
  { re: /\b(nazis?|swastikas?|kkk|racis[mt]\w*)\b/i, reason: REASONS.hate },
  { re: /\b(logos?|brand(ed|s)?|trademark|coca[- ]?cola|pepsi|nike|adidas|google|microsoft|mcdonald'?s|starbucks|disney|tesla|facebook|instagram|tiktok|netflix|red ?bull)\b/i, reason: REASONS.brand },
  { re: /["“”]|\b(says|saying|reads|reading|written|writ(e|es|ing)|spell(s|ed|ing)?|words?|text|messages?|captions?|graffiti|letters?|banner)\b/i, reason: REASONS.words },
  { re: /https?:|www\.|@\w|\b(guy|girl|man|woman|men|women|person|people|someone|somebody|everyone|everybody|audience|judges?|attendees?|crowd|kids?|boy|lady|dude|he|she|him|her|his|you|your|me|my|i)\b/i, reason: REASONS.people },
];

/** Content rules (not people/words), also checked against disguised spellings. */
const CONTENT = BLOCK.filter((r) => r.reason !== REASONS.people && r.reason !== REASONS.words);

/** NFKC, drop control and invisible format characters (zero-width, soft hyphen, bidi), collapse whitespace. */
export function normalizeInput(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\t\n\r\v\f]/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Look-alike Cyrillic/Greek letters → Latin, for checking only (never for display). */
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ј: "j", ѕ: "s",
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Disguised spellings of the input to check against the content rules (not the people/words rules). */
function disguises(text: string): string[] {
  const lower = text.toLowerCase();
  const unconfused = [...lower].map((c) => CONFUSABLES[c] ?? c).join("");
  // Only words that mix letters with digits/symbols are de-leeted, so "aisle 4" stays as is.
  const deleet = (map: Record<string, string>) =>
    unconfused.replace(/\S+/g, (w) => (/[a-z]/.test(w) && /[0-9@$]/.test(w) ? [...w].map((c) => map[c] ?? c).join("") : w));
  const out = [unconfused, deleet(LEET), deleet({ ...LEET, "1": "l" })];
  // Runs of 3+ single letters ("g u n", "g.u.n") are joined; every suffix is checked as a word.
  for (const run of unconfused.match(/\b[a-z](?:[\s.\-_*]+[a-z]\b){2,}/g) ?? []) {
    const joined = run.replace(/[^a-z]/g, "");
    for (let i = 0; i < joined.length - 1; i++) out.push(joined.slice(i));
  }
  return out;
}

export function blockedReason(text: string): string | undefined {
  if (!text || text.length > 80) return REASONS.length;
  const direct = BLOCK.find((rule) => rule.re.test(text))?.reason;
  if (direct) return direct;
  if (/[<>]/.test(text)) return REASONS.words;
  const variants = disguises(text);
  return CONTENT.find((rule) => variants.some((v) => rule.re.test(v)))?.reason;
}

/** A private, prewritten way to keep the harmless part of a rejected idea. */
export function alternativeFor(text: string): string {
  if (/hurricane|cyclone|tornado/i.test(text) && /\b(?:two|twin|double|pair|2)\b/i.test(text)) return "Two tight wind funnels sweep leaves across the aisle";
  if (/wind|hurricane|storm|cyclone|tornado|weather|roof/i.test(text)) return "A gust sweeps loose papers across the aisle";
  if (/water|rain|flood|wave|tsunami|spill/i.test(text)) return "A shallow puddle spreads across the aisle";
  if (/light|fire|flash|laser|explod|blast|bomb/i.test(text)) return "The lamps flash once and cast long shadows";
  if (/hit|fall|push|throw|knock|attack|chase|crush|shoot/i.test(text)) return "A foam ball bounces into the robot’s path";
  if (/name|sign|text|logo|words|message/i.test(text)) return "A sign swings gently across the flashlight beam";
  return "A shadow sweeps across the hallway floor";
}

type Event = { re: RegExp; tags: HauntTag[]; canonical: string };

/** World-event keywords. The first match supplies the canonical rewrite; tags merge in order (max 3). */
const EVENTS: Event[] = [
  { re: /\b(banana|peels?)\b/i, tags: ["distractor", "geometry"], canonical: "A banana peel lands in the aisle" },
  { re: /\b(fog|foggy|mist|misty|haze|hazy)\b/i, tags: ["visibility", "weather"], canonical: "Thick fog rolls down the hallway" },
  { re: /\b(smoke|smoky|steam|dust|dusty)\b/i, tags: ["visibility"], canonical: "Smoke fills the hallway" },
  { re: /\b(lights?|lamps?|flicker\w*|dim\w*|dark\w*|blackout|power|outage)\b/i, tags: ["lighting"], canonical: "The hallway lights flicker and dim" },
  { re: /\b(shadows?)\b/i, tags: ["lighting"], canonical: "Long shadows stretch across the hallway" },
  { re: /\b(winds?|windy|gusts?|breeze|draft)\b/i, tags: ["weather", "distractor"], canonical: "A gust of wind blows down the hallway" },
  { re: /\b(papers?|leaves|leaf|confetti)\b/i, tags: ["distractor"], canonical: "Loose papers scatter across the aisle" },
  { re: /\b(rain\w*|snow\w*|hail|storm\w*|drizzle)\b/i, tags: ["weather"], canonical: "Rain starts falling in the hallway" },
  { re: /\b(marbles?|balls?|puddles?|water|spill\w*|slippery|ice|icy|oil)\b/i, tags: ["distractor", "geometry"], canonical: "Marbles scatter across the floor" },
  { re: /\b(balloons?)\b/i, tags: ["occlusion", "distractor"], canonical: "A bunch of balloons drifts across the hall" },
  { re: /\b(chairs?|tables?|box(es)?|crates?|carts?|buckets?|cones?|ladders?|bins?|trash|barrels?|benches?|desks?|plants?|furniture)\b/i, tags: ["geometry"], canonical: "A chair tips over in the middle of the aisle" },
  { re: /\b(blocks?|blocked|curtains?|covers?|hides?)\b/i, tags: ["occlusion"], canonical: "A heavy curtain drops across half the aisle" },
  { re: /\b(cats?|dogs?|pigeons?|birds?|mice|mouse|rats?|squirrels?|raccoons?)\b/i, tags: ["distractor"], canonical: "A cat darts across the aisle" },
  { re: /\b(signs?|exit|arrows?|doors?)\b/i, tags: ["sign_change"], canonical: "The EXIT sign slides to the other wall" },
  { re: /\b(mirrors?|glare|reflections?)\b/i, tags: ["visibility"], canonical: "A tall mirror appears at the end of the hall" },
  { re: /\b(alarms?|sirens?|bangs?|noise|music|bells?|ringing|creak\w*|thunder)\b/i, tags: ["audio"], canonical: "A fire alarm starts ringing" },
];

const FILLER = /\b(lol|lmao|lmfao|rofl|haha\w*|omg|pls|plz|please|lets|let's|just|like|bro)\b/gi;
const IMPERATIVE = /^(drop|make|add|spill|release|cut|roll|throw|put|turn|send|bring|start|give|cause|have|let|do)\b/i;

function clean(text: string): string {
  return text.replace(FILLER, " ").replace(/[!?.,;:]+/g, " ").replace(/\s+/g, " ").trim();
}

function truncate60(s: string): string {
  if (s.length <= 60) return s;
  const cut = s.slice(0, 61);
  const space = cut.lastIndexOf(" ");
  return (space > 30 ? cut.slice(0, space) : s.slice(0, 60)).trim();
}

function rejected(reason: string, input: string): Moderated {
  return { safe: false, text: "", tags: [], reason, suggestion: alternativeFor(input), model: "rules-only" };
}

export class RulesOnlyModeration implements ModerationAdapter {
  readonly name = "rules-only";

  async moderate(input: string): Promise<Moderated> {
    const text = normalizeInput(input);
    const reason = blockedReason(text);
    if (reason) return rejected(reason, text);
    if (/\b(hurricanes?|tornad(?:o|oes)|tsunamis?|cyclones?)\b/i.test(text)) return rejected("Give the storm one visible effect inside the hallway.", text);

    const matches = EVENTS.filter((e) => e.re.test(text));
    if (matches.length === 0) return rejected(REASONS.notEvent, text);
    const tags = [...new Set(matches.flatMap((m) => m.tags))].slice(0, 3);

    const cleaned = clean(text);
    const words = cleaned.split(" ").filter(Boolean);
    const useCanonical = words.length <= 3 || IMPERATIVE.test(cleaned);
    const breeze = /\bbreezes?\b/i.test(cleaned);
    const sentence = useCanonical && breeze ? "A breeze passes through the hallway" : useCanonical ? matches[0]!.canonical : cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return { safe: true, text: truncate60(sentence), tags, model: "rules-only" };
  }

  nickname(name: string): string | undefined {
    const n = normalizeInput(name);
    if (n.length === 0 || n.length > 16) return undefined;
    const variants = [n, ...disguises(n)];
    if (CONTENT.some((r) => variants.some((v) => r.re.test(v)))) return undefined;
    if (/[<>]|https?:|www\.|@/.test(n)) return undefined;
    return n;
  }
}

import type { Moderated } from "@poltergeist/contracts/haunt.js";

/** Seam for `PG_MODERATION_ADAPTER` (`hydrogen` | `rules-only`). */
export interface ModerationAdapter {
  readonly name: string;
  /** Moderate one free-text proposal (≤ 80 chars). Never throws for unsafe input; returns safe=false with a short reason. */
  moderate(text: string): Promise<Moderated>;
  /** Returns the nickname if it is display-safe, otherwise undefined (the haunt then shows as anon). */
  nickname(name: string): string | undefined;
}

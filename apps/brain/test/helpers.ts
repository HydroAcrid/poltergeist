import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TickRequest } from "@poltergeist/contracts/tick-request.js";
import { FIXTURE_ZERO } from "../server/perception/fixture.js";

export const EP = "ep_01JDPG00000000000000000001";

export const frameB64 = (file: string) => readFileSync(join(FIXTURE_ZERO, file)).toString("base64");

export function req(seq: number, b64 = "AAAA", extra: Partial<TickRequest> = {}): TickRequest {
  return {
    episodeId: EP,
    seq,
    t: seq * 500,
    driver: "brain",
    frame: { mime: "image/jpeg", width: 640, height: 360, b64 },
    frameDiff: 0.1,
    recentHaunts: [],
    ...extra,
  };
}

export const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

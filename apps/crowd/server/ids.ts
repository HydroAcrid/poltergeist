import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Prefixed ULID, e.g. `ht_01JDGZ8Q4M…` (CONTRACTS §2). */
export function newId(prefix: "ht" | "ep" | "ev", now = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i]! % 32];
  return `${prefix}_${time}${rand}`;
}

/** Opaque device id for the `pg_device` cookie. */
export function newDeviceId(): string {
  return `dv_${randomBytes(12).toString("base64url")}`;
}

export const DEVICE_ID_RE = /^dv_[A-Za-z0-9_-]{16}$/;

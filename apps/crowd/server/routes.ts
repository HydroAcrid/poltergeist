// Crowd HTTP surface (CONTRACTS C17) and the /haunt page.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { CrowdState, HauntSubmitRequest, type ErrorCode } from "@poltergeist/contracts/haunt.js";
import { OperatorCommand } from "@poltergeist/contracts/operator.js";
import type { CrowdService } from "./crowd.js";
import { DEVICE_ID_RE, newDeviceId } from "./ids.js";

const COOKIE = "pg_device";
const CROWD_COMMANDS: ReadonlySet<OperatorCommand["cmd"]> = new Set(["haunt.approve", "haunt.reject", "haunt.releaseSeeded", "finals.approvalMode"]);
const YEAR_S = 365 * 24 * 3600;

function readCookie(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** deviceId comes from the cookie only; a missing or malformed cookie gets a fresh id. */
function deviceOf(req: FastifyRequest, reply: FastifyReply): string {
  const existing = readCookie(req, COOKIE);
  if (existing && DEVICE_ID_RE.test(existing)) return existing;
  const id = newDeviceId();
  reply.header("set-cookie", `${COOKIE}=${id}; Path=/; Max-Age=${YEAR_S}; SameSite=Lax; HttpOnly`);
  return id;
}

function fail(reply: FastifyReply, http: number, code: ErrorCode, message: string) {
  return reply.code(http).send({ error: { code, message } });
}

export interface RouteOptions {
  operatorToken?: string;
  hauntPagePath: string;
  overlayPagePath?: string;
  overlayModelPath?: string;
  veilDir?: string;
  publicUrl?: string; // PG_PUBLIC_URL; the join QR points at <publicUrl>/haunt
  validateResponses?: boolean;
}

export async function registerCrowdRoutes(app: FastifyInstance, crowd: CrowdService, opts: RouteOptions): Promise<void> {
  let page: string | null = null;
  // Phones are on venue Wi-Fi: serve the page without indentation, blank lines, whole-line //
  // comments and /* */ comments (the source stays readable). Safe because the page has no <pre>,
  // no template literals and no "//" at the start of any non-comment line (checked in tests).
  const compact = (html: string) =>
    html
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]+/gm, "")
      .replace(/^\/\/.*$/gm, "")
      .replace(/\n{2,}/g, "\n");
  const loadPage = () => (page ??= compact(readFileSync(opts.hauntPagePath, "utf8")));
  let compressedPage: Buffer | undefined;

  app.post("/api/crowd/haunt", { bodyLimit: 2048 }, async (req, reply) => {
    const deviceId = deviceOf(req, reply);
    const parsed = HauntSubmitRequest.safeParse(req.body ?? {});
    if (!parsed.success) return fail(reply, 400, "INVALID", "Send an idea of up to 80 characters, or tap a preset.");
    const r = crowd.submit(deviceId, parsed.data);
    if (!r.ok) return fail(reply, r.code === "RATE_LIMITED" ? 429 : 400, r.code, r.message);
    return { hauntId: r.hauntId, status: r.status };
  });

  app.get("/api/crowd/presets", async () => crowd.presets);

  app.get<{ Querystring: { waitingPage?: string } }>("/api/crowd/state", async (req, reply) => {
    const page = req.query.waitingPage;
    if (page !== undefined && (typeof page !== "string" || !/^\d{1,8}$/.test(page))) {
      return fail(reply, 400, "INVALID", "Choose a valid waiting page.");
    }
    const deviceId = deviceOf(req, reply);
    if (req.headers["x-pg-client"] === "phone") crowd.noteGuest(deviceId); // the projector doesn't send this
    const state = crowd.state(deviceId, page === undefined ? undefined : Number(page));
    const { waiting, ...core } = state;
    const checked = opts.validateResponses ? CrowdState.parse(core) : core;
    if (!waiting) {
      reply.header("cache-control", "no-store");
      return checked;
    }
    reply.header("cache-control", "private, no-store");
    // The validator includes the author's own receipts, page, round and current
    // order. Two phones must never reuse one another's cached representation.
    const body = JSON.stringify({ ...checked, waiting });
    const tag = '"' + createHash("sha256").update(body).digest("base64url") + '"';
    reply.header("vary", "Cookie").header("etag", tag);
    if (req.headers["if-none-match"] === tag) return reply.code(304).send();
    return reply.type("application/json").send(body);
  });

  // Waiting-room headcount for the projector and phones (no cookie, no device ids).
  app.get("/api/crowd/lobby", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return crowd.joined();
  });

  app.get("/api/crowd/scoreboard", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return crowd.scoreboard();
  });

  const isOperator = (req: FastifyRequest) => !!opts.operatorToken && req.headers["x-pg-token"] === opts.operatorToken;

  app.get("/api/crowd/queue", async (req, reply) => {
    if (!isOperator(req)) return fail(reply, 401, "UNAUTHORIZED", "Operator token required.");
    return crowd.allHaunts();
  });

  // Operator commands Crowd owns (C14). World/Brain commands (round, replay, mode, dares, policy,
  // coach) are refused here; only Crowd-scoped ones are published as `operator.command`.
  app.post("/api/crowd/operator", { bodyLimit: 2048 }, async (req, reply) => {
    if (!isOperator(req)) return fail(reply, 401, "UNAUTHORIZED", "Operator token required.");
    const parsed = OperatorCommand.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "INVALID", "Not a valid operator command.");
    if (!CROWD_COMMANDS.has(parsed.data.cmd)) return fail(reply, 400, "INVALID", "Crowd only handles haunt.approve, haunt.reject, haunt.releaseSeeded and finals.approvalMode.");
    crowd.publishOperatorCommand(parsed.data);
    return { ok: true, command: parsed.data };
  });

  // Projector overlay (transparent; World layers it over /stage) and its pure logic module.
  if (opts.overlayPagePath && opts.overlayModelPath) {
    const overlayPage = opts.overlayPagePath;
    const overlayModel = opts.overlayModelPath;
    app.get("/overlay", async (_req, reply) => {
      reply.header("cache-control", "no-cache").type("text/html; charset=utf-8");
      return readFileSync(overlayPage, "utf8");
    });
    app.get("/overlay-model.js", async (_req, reply) => {
      reply.header("cache-control", "no-cache").type("text/javascript; charset=utf-8");
      return readFileSync(overlayModel, "utf8");
    });
  }

  // Ghost veil for World's opening transition (art direction: Crowd). World imports
  // /veil/ghost-veil.js and calls cover()/part(); see apps/crowd/docs/veil.md.
  if (opts.veilDir) {
    const veilDir = opts.veilDir;
    for (const file of ["ghost-veil.js", "veil-machine.js"]) {
      app.get(`/veil/${file}`, async (_req, reply) => {
        reply.header("cache-control", "no-cache").type("text/javascript; charset=utf-8");
        return readFileSync(`${veilDir}/${file}`, "utf8");
      });
    }
  }

  // QR for the join link, rendered server-side so the overlay stays dependency-free.
  const qrCache = new Map<string, string>();
  app.get("/api/crowd/join.svg", async (req, reply) => {
    const host = String(req.headers.host ?? "localhost").replace(/[^A-Za-z0-9.:\-\[\]]/g, "");
    const url = (opts.publicUrl || `${req.protocol}://${host}`).replace(/\/$/, "") + "/haunt";
    let svg = qrCache.get(url);
    if (!svg) {
      svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#171614", light: "#fff6e8" } });
      qrCache.set(url, svg);
    }
    reply.header("cache-control", "no-cache").type("image/svg+xml");
    return svg;
  });

  app.get("/haunt", async (req, reply) => {
    reply.header("cache-control", "no-cache").header("vary", "Accept-Encoding").type("text/html; charset=utf-8");
    const encodings = String(req.headers["accept-encoding"] ?? "").split(",").map((e) => e.trim().toLowerCase());
    if (encodings.includes("gzip")) {
      reply.header("content-encoding", "gzip");
      return compressedPage ??= gzipSync(loadPage());
    }
    return loadPage();
  });
}

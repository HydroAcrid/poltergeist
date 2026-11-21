// Crowd HTTP surface (CONTRACTS C17) and the /haunt page.
import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { CrowdState, HauntSubmitRequest, type ErrorCode } from "@poltergeist/contracts/haunt.js";
import type { CrowdService } from "./crowd.js";
import { DEVICE_ID_RE, newDeviceId } from "./ids.js";

const COOKIE = "pg_device";
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
  // Phones are on venue Wi-Fi: serve the page without each line's leading indentation and blank
  // lines (the source stays readable). The page has no <pre> or multi-line strings, so this is safe.
  const compact = (html: string) => html.replace(/^[ \t]+/gm, "").replace(/\n{2,}/g, "\n");
  const loadPage = () => (page ??= compact(readFileSync(opts.hauntPagePath, "utf8")));

  app.post("/api/crowd/haunt", { bodyLimit: 2048 }, async (req, reply) => {
    const deviceId = deviceOf(req, reply);
    const parsed = HauntSubmitRequest.safeParse(req.body ?? {});
    if (!parsed.success) return fail(reply, 400, "INVALID", "Send an idea of up to 80 characters, or tap a preset.");
    const r = crowd.submit(deviceId, parsed.data);
    if (!r.ok) return fail(reply, r.code === "RATE_LIMITED" ? 429 : 400, r.code, r.message);
    return { hauntId: r.hauntId, status: r.status };
  });

  app.get("/api/crowd/presets", async () => crowd.presets);

  app.get("/api/crowd/state", async (req, reply) => {
    const state = crowd.state(deviceOf(req, reply));
    reply.header("cache-control", "no-store");
    return opts.validateResponses ? CrowdState.parse(state) : state;
  });

  app.get("/api/crowd/scoreboard", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return crowd.scoreboard();
  });

  app.get("/api/crowd/queue", async (req, reply) => {
    const token = req.headers["x-pg-token"];
    if (!opts.operatorToken || token !== opts.operatorToken) return fail(reply, 401, "UNAUTHORIZED", "Operator token required.");
    return crowd.allHaunts();
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

  app.get("/haunt", async (_req, reply) => {
    reply.header("cache-control", "no-cache").type("text/html; charset=utf-8");
    return loadPage();
  });
}

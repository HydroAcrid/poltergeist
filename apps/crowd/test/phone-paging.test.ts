import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestHub, type TestHub } from "./hub.js";

let hub: TestHub;
beforeEach(async () => { hub = await buildTestHub(); });
afterEach(async () => { await hub.close(); });

async function state(cookie: string, page?: string, tag?: string) {
  return hub.app.inject({
    method: "GET",
    url: "/api/crowd/state" + (page === undefined ? "" : "?waitingPage=" + page),
    headers: { cookie, ...(tag ? { "if-none-match": tag } : {}) },
  });
}

async function join() {
  const res = await state("");
  return String(res.headers["set-cookie"]).split(";")[0]!;
}
async function submit(cookie: string, body: { preset: string } | { text: string }) {
  const response = await hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie }, payload: body });
  expect(response.statusCode).toBe(200);
  await hub.crowd.whenIdle();
  hub.clock.advance(1);
  return response.json().hauntId as string;
}

describe("paged phone state", () => {
  it("retains every eligible idea, the shared head, and the author's off-page position", async () => {
    const authors = [], ids = [];
    for (let index = 0; index < 33; index++) {
      const author = await join();
      authors.push(author);
      ids.push(await submit(author, { preset: "marbles" }));
    }
    const author = authors.at(-1)!;
    const canonical = (await state(author)).json();
    expect(canonical.queue.map((h: { hauntId: string }) => h.hauntId)).toEqual(ids);
    expect(canonical.waiting).toBeUndefined();
    const all: string[] = [];
    for (const page of [0, 1, 2]) {
      const response = await state(author, String(page));
      expect(response.statusCode).toBe(200);
      const view = response.json();
      expect(view.waiting).toEqual({ total: 32, size: 15, page, myPositions: { [ids[32]!]: 33 } });
      expect(view.queue[0].hauntId).toBe(ids[0]);
      expect(view.mine).toEqual(canonical.mine);
      all.push(...view.queue.slice(1).map((h: { hauntId: string }) => h.hauntId));
    }
    expect(all).toEqual(ids.slice(1));
    expect((await state(author, "999")).json().waiting.page).toBe(2);
    expect((await state(author, "-1")).statusCode).toBe(400);
    expect((await state(author, "abc")).statusCode).toBe(400);
  });

  it("revalidates only an identical phone view, including private moderation feedback", async () => {
    const author = await join(), reader = await join();
    const first = await state(author, "0");
    const tag = String(first.headers.etag);
    expect(tag).toMatch(/^".+"$/);
    expect(first.headers.vary).toBe("Cookie");
    expect(first.headers["cache-control"]).toContain("private");
    expect(first.json().waiting.total).toBe(0);
    const cached = await state(author, "0", tag);
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe("");
    const other = await state(reader, "0", tag);
    expect(other.statusCode).toBe(200);
    const rejected = await submit(author, { text: "A hurricane blows the roof off" });
    const changed = await state(author, "0", tag);
    expect(changed.statusCode).toBe(200);
    expect(changed.json().mine[0]).toMatchObject({ hauntId: rejected, status: "rejected" });
    expect(changed.json().mine[0].moderated.suggestion).toBeTruthy();
    const unchanged = await state(reader, "0", String(other.headers.etag));
    expect(unchanged.statusCode).toBe(304);
    await submit(reader, { preset: "marbles" });
    expect((await state(author, "0", String(changed.headers.etag))).statusCode).toBe(200);
  });
});

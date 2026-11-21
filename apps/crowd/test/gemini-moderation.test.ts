import { describe, expect, it, vi } from "vitest";
import { GeminiModeration } from "../server/moderation/gemini.js";

const model = "gemini-4-hydrogen";
function requestFor(result: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
  }));
}
describe("Gemini review of custom hallway events", () => {
  it("sends novel proposals through the model and retains accepted objects", async () => {
    const request = requestFor({ decision: "accept", text: "A pineapple rolls across the aisle", tags: ["distractor"] });
    const result = await new GeminiModeration("test", model, request).moderate("a pineapple rolls across the aisle");
    expect(result).toMatchObject({safe: true, text: "A pineapple rolls across the aisle", model});
    expect(request).toHaveBeenCalledOnce();
  });
  it("offers a scaled-down storm privately, without scheduling it as the original", async () => {
    const request = requestFor({ decision: "revise", reason: "scale", suggestion: "Papers swirl across the aisle" });
    const result = await new GeminiModeration("test", model, request).moderate("a hurricane tears the roof off");
    expect(result).toMatchObject({safe: false, text: "", tags: [], suggestion: "Papers swirl across the aisle"});
  });
  it("keeps sensitive input out of the model and gives a related safe alternative", async () => {
    const request = requestFor({});
    const result = await new GeminiModeration("test", model, request).moderate("a hurricane hits everyone in the room");
    expect(request).not.toHaveBeenCalled();
    expect(result).toMatchObject({safe: false, text: "", suggestion:"A gust sweeps loose papers across the aisle"});
  });
  it("never approves a broken or missing model reply", async () => {
    const request = requestFor({ decision: "accept", text: "invented", tags: ["invalid"] });
    expect((await new GeminiModeration("test", model, request).moderate("sdfsjdjfds")).safe).toBe(false);
    expect((await new GeminiModeration("", model, request).moderate("a hurricane")).safe).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("drops unsafe content in a model suggestion", async () => {
    const request = requestFor({decision:"revise",reason:"scale",suggestion:"Shoot everyone"});
    const result = await new GeminiModeration("test",model,request).moderate("a hurricane");
    expect(result.suggestion).toBe("A gust sweeps loose papers across the aisle");
  });
});

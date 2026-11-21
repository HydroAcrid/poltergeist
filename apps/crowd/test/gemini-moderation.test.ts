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
  it("strips control and invisible characters from accepted text and suggestions", async () => {
    const accepted = await new GeminiModeration("test", model, requestFor({ decision: "accept", text: "A pine​apple\u0000 rolls‮ across\tthe aisle", tags: ["distractor"] })).moderate("a pineapple rolls across the aisle");
    expect(accepted).toMatchObject({ safe: true, text: "A pineapple rolls across the aisle" });
    const revised = await new GeminiModeration("test", model, requestFor({ decision: "revise", reason: "scale", suggestion: "Papers‍ swirl­ across the aisle" })).moderate("a hurricane");
    expect(revised.suggestion).toBe("Papers swirl across the aisle");
  });
  it("rejects model text that hides blocked words, markup or becomes empty once cleaned", async () => {
    for (const text of ["A g​un rolls across the aisle", "A k1ll3r chair tips over", "A <b>bold</b> chair tips over", "​‍\u0000"]) {
      const result = await new GeminiModeration("test", model, requestFor({ decision: "accept", text, tags: ["geometry"] })).moderate("a chair tips over");
      expect(result.safe, JSON.stringify(text)).toBe(false);
      expect(result.text).toBe("");
    }
  });
  it("replaces a model suggestion that hides blocked words or is empty once cleaned", async () => {
    for (const suggestion of ["Papers swirl past a g​un", "​‍"]) {
      const result = await new GeminiModeration("test", model, requestFor({ decision: "revise", reason: "scale", suggestion })).moderate("a hurricane");
      expect(result.suggestion, JSON.stringify(suggestion)).toBe("A gust sweeps loose papers across the aisle");
    }
  });
});

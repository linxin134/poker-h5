import { describe, expect, it } from "vitest";
import { actionVoices, soundPatterns, type SoundKind } from "../src/services/audio";

describe("牌局音效配置", () => {
  it("覆盖发牌、行动、倒计时、结算和互动场景", () => {
    const required: SoundKind[] = ["click", "deal", "check", "chips", "fold", "street", "allin", "turn", "countdown", "collect", "win", "emoji"];
    expect(Object.keys(soundPatterns).sort()).toEqual([...required].sort());
    for (const kind of required) {
      expect(soundPatterns[kind].length).toBeGreaterThan(0);
      for (const step of soundPatterns[kind]) {
        expect(step.frequency).toBeGreaterThan(0);
        expect(step.duration).toBeGreaterThan(0);
        expect(step.offset).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("四种下注行动都有模拟人声文案", () => {
    expect(actionVoices).toEqual({
      fold: { text: "弃牌", lang: "zh-CN" },
      call: { text: "跟注", lang: "zh-CN" },
      raise: { text: "加注", lang: "zh-CN" },
      "all-in": { text: "ALL IN", lang: "en-US" }
    });
  });
});

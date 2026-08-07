import type { LlmImageDto, LlmMessageDto, LlmResponseFormat } from "@acos/shared";
import { createDefaultPromptEngine } from "../prompt/default-engine";
import type { VisionImageInput } from "../vision/vision-provider";
import { DesignReviewParseError } from "./design-review";
import { DesignReviewEngine, type DesignReviewLlmClient } from "./design-review-engine";

const validResult = {
  layout: "Hero → 구매포인트 → 특징 → 스펙 순서",
  typography: "제목 20px, 본문 13px",
  whitespace: "충분함",
  imagePlacement: "Hero 사진이 상단 40% 차지",
  colorUsage: "인디고 포인트 컬러",
  visualHierarchy: "제목 → 사진 → 특징",
  purchaseMotivation: "구매 포인트 칩이 눈에 잘 들어옴",
  mobileUx: "스크롤이 자연스러움",
  strengths: ["사진 활용이 좋음"],
  improvements: ["스펙표 폰트가 작음"],
  overallScore: 78,
  summary: "전반적으로 쇼핑몰 상세페이지에 근접한 수준",
};

function image(id: string, mimeType = "image/png", bytes = new Uint8Array([1, 2, 3])): VisionImageInput {
  return { id, mimeType, getBytes: async () => bytes };
}

function stubComplete(
  text: string,
  calls: { messages: LlmMessageDto[]; images: LlmImageDto[]; responseFormat: LlmResponseFormat; step: "review" }[],
): DesignReviewLlmClient {
  return async (request) => {
    calls.push(request);
    return { provider: "gemini", model: "gemini-2.0-flash", text };
  };
}

describe("DesignReviewEngine", () => {
  it("스크린샷을 첨부해 한 번 호출하고 결과를 파싱한다", async () => {
    const calls: Parameters<DesignReviewLlmClient>[0][] = [];
    const engine = new DesignReviewEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "gemini",
      complete: stubComplete(JSON.stringify(validResult), calls),
    });

    const { result, raw } = await engine.run({
      images: [image("shot-1"), image("shot-2")],
      category: "캠핑용품",
      notes: "Template V1 시안",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].step).toBe("review");
    expect(calls[0].images).toHaveLength(2);
    expect(result).toEqual(validResult);
    expect(raw.provider).toBe("gemini");
    expect(raw.imageCount).toBe(2);
    expect(raw.skippedImages).toEqual([]);
  });

  it("허용되지 않는 형식의 이미지는 건너뛰고 나머지로 계속한다", async () => {
    const calls: Parameters<DesignReviewLlmClient>[0][] = [];
    const engine = new DesignReviewEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "gemini",
      complete: stubComplete(JSON.stringify(validResult), calls),
    });

    const { raw } = await engine.run({
      images: [image("ok", "image/png"), image("bad", "application/pdf")],
      category: "캠핑용품",
    });

    expect(calls[0].images).toHaveLength(1);
    expect(raw.skippedImages).toEqual([
      { id: "bad", reason: expect.stringContaining("허용되지 않는") },
    ]);
  });

  it("응답이 해석 불가면 reject한다", async () => {
    const calls: Parameters<DesignReviewLlmClient>[0][] = [];
    const engine = new DesignReviewEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "gemini",
      complete: stubComplete("이건 JSON이 아니다", calls),
    });

    await expect(
      engine.run({ images: [image("shot-1")], category: "캠핑용품" }),
    ).rejects.toThrow(DesignReviewParseError);
  });
});

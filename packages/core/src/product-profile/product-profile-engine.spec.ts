import type { LlmImageDto, LlmMessageDto, LlmResponseFormat } from "@acos/shared";
import { createDefaultPromptEngine } from "../prompt/default-engine";
import type { VisionImageInput } from "../vision/vision-provider";
import { ImageFeatureParseError } from "./image-feature-analysis";
import { ProductPageCopyParseError } from "./product-page-copy";
import { ProductProfileEngine, type ProductProfileLlmClient } from "./product-profile-engine";

const validFeatures = {
  material: "PVC",
  color: "그레이",
  structure: "접이식 매트",
  usage: "주방 바닥 매트",
  components: ["매트 본체"],
  notes: null,
  confidence: 0.8,
  photoTypes: ["DESIGN", "DESIGN"],
};

const validProfile = {
  productName: "Magic Clean PVC 주방 매트",
  brand: "Magic Clean",
  model: null,
  material: "PVC",
  features: ["접이식"],
  specifications: {},
  usage: "주방 바닥에 깔아 사용",
  advantages: ["물세척 가능"],
  warnings: [],
  keywords: ["주방매트"],
  confidence: 0.75,
};

const validCopy = {
  headline: "접어서 보관하는 PVC 주방 매트",
  description: "물세척이 가능한 접이식 PVC 매트로 주방 바닥을 깔끔하게 지켜줍니다.",
};

function image(id: string, mimeType: string, bytes = new Uint8Array([1, 2, 3])): VisionImageInput {
  return { id, mimeType, getBytes: async () => bytes };
}

/** step별로 서로 다른 응답을 돌려주는 스텁 — 실 LLM Gateway 대신 사용 */
function stubComplete(
  responses: Partial<Record<"vision" | "synthesis" | "copy", string>>,
  calls: {
    messages: LlmMessageDto[];
    images: LlmImageDto[];
    responseFormat: LlmResponseFormat;
    step: "vision" | "synthesis" | "copy";
    projectId?: string;
  }[],
): ProductProfileLlmClient {
  return async (request) => {
    calls.push(request);
    const defaults: Record<"vision" | "synthesis" | "copy", string> = {
      vision: JSON.stringify(validFeatures),
      synthesis: JSON.stringify(validProfile),
      copy: JSON.stringify(validCopy),
    };
    const text = responses[request.step] ?? defaults[request.step];
    return { provider: "openai", model: "gpt-4o", text };
  };
}

describe("ProductProfileEngine", () => {
  it("이미지 특징 분석(STEP 3) → Profile 통합(STEP 4) → 카피 생성(STEP 5) 순서로 세 번 호출하고 HTML을 렌더링한다", async () => {
    const calls: Parameters<ProductProfileLlmClient>[0][] = [];
    const engine = new ProductProfileEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "openai",
      complete: stubComplete({}, calls),
    });

    const result = await engine.run({
      images: [image("img-1", "image/png"), image("img-2", "image/jpeg")],
      ocrTexts: ["Magic Clean PVC Mat"],
      projectId: "proj-1",
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].step).toBe("vision");
    expect(calls[0].images).toHaveLength(2);
    expect(calls[1].step).toBe("synthesis");
    // STEP 4·STEP 5는 이미지를 다시 첨부하지 않는다
    expect(calls[1].images).toEqual([]);
    expect(calls[2].step).toBe("copy");
    expect(calls[2].images).toEqual([]);

    expect(result.imageFeatures).toEqual(validFeatures);
    expect(result.profile).toEqual(validProfile);
    expect(result.pageCopy).toEqual(validCopy);
    expect(result.html).toContain(validProfile.productName);
    expect(result.html).toContain(validCopy.headline);
    expect(result.css).toContain(".pde-page");
    expect(result.raw.provider).toBe("llm:openai");
    expect(result.raw.imageCount).toBe(2);
    expect(result.raw.skippedImages).toEqual([]);
    expect(result.raw.omittedImageCount).toBe(0);
  });

  it("허용되지 않는 형식의 이미지는 건너뛰고 나머지로 계속한다", async () => {
    const calls: Parameters<ProductProfileLlmClient>[0][] = [];
    const engine = new ProductProfileEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "openai",
      complete: stubComplete({}, calls),
    });

    const result = await engine.run({
      images: [image("img-1", "image/png"), image("img-bad", "application/pdf")],
      ocrTexts: [],
    });

    expect(calls[0].images).toHaveLength(1);
    expect(result.raw.skippedImages).toEqual([
      { id: "img-bad", reason: expect.stringContaining("허용되지 않는") },
    ]);
  });

  it("maxImages를 초과하는 이미지는 잘라내고 omittedImageCount에 반영한다", async () => {
    const calls: Parameters<ProductProfileLlmClient>[0][] = [];
    const engine = new ProductProfileEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "openai",
      maxImages: 2,
      complete: stubComplete({}, calls),
    });

    const result = await engine.run({
      images: [image("a", "image/png"), image("b", "image/png"), image("c", "image/png")],
      ocrTexts: [],
    });

    expect(calls[0].images).toHaveLength(2);
    expect(result.raw.omittedImageCount).toBe(1);
  });

  it("STEP 3 응답이 해석 불가면 STEP 4를 부르지 않고 그대로 reject한다", async () => {
    const calls: Parameters<ProductProfileLlmClient>[0][] = [];
    const engine = new ProductProfileEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "openai",
      complete: stubComplete({ vision: "이건 JSON이 아니다" }, calls),
    });

    await expect(
      engine.run({ images: [image("a", "image/png")], ocrTexts: [] }),
    ).rejects.toThrow(ImageFeatureParseError);
    expect(calls).toHaveLength(1); // synthesis 는 불리지 않았다
  });

  it("STEP 5(카피) 응답이 해석 불가면 그대로 reject한다", async () => {
    const calls: Parameters<ProductProfileLlmClient>[0][] = [];
    const engine = new ProductProfileEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "openai",
      complete: stubComplete({ copy: "이건 JSON이 아니다" }, calls),
    });

    await expect(
      engine.run({ images: [image("a", "image/png")], ocrTexts: [] }),
    ).rejects.toThrow(ProductPageCopyParseError);
    expect(calls).toHaveLength(3); // vision·synthesis는 끝났고 copy에서 실패했다
  });

  it("사진 유형 자동 분류(CTO 지시) - INFO로 분류된 사진은 HTML에서 제외하고 photoTypeByImageId로 알려준다", async () => {
    const calls: Parameters<ProductProfileLlmClient>[0][] = [];
    const engine = new ProductProfileEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "openai",
      complete: stubComplete(
        {
          vision: JSON.stringify({ ...validFeatures, photoTypes: ["DESIGN", "INFO"] }),
        },
        calls,
      ),
    });

    const result = await engine.run({
      images: [image("photo-front", "image/png"), image("photo-label", "image/jpeg")],
      ocrTexts: [],
    });

    expect(result.photoTypeByImageId).toEqual([
      { imageId: "photo-front", photoType: "DESIGN" },
      { imageId: "photo-label", photoType: "INFO" },
    ]);
    // STEP 3(vision)에는 두 장 다 첨부되지만(정보 추출용으로도 봐야 하니까)
    expect(calls[0].images).toHaveLength(2);
    // STEP 5b(HTML)에는 DESIGN으로 분류된 photo-front(png)만 들어가고,
    // INFO로 분류된 photo-label(jpeg)은 들어가지 않는다
    expect(result.html).toContain("image/png");
    expect(result.html).not.toContain("image/jpeg");
  });

  it("교차 검증(T1-23/T1-24) — OCR과 GPT 분석의 브랜드가 다르면 identification·crossVerification을 함께 돌려준다", async () => {
    const calls: Parameters<ProductProfileLlmClient>[0][] = [];
    const engine = new ProductProfileEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "openai",
      complete: stubComplete({}, calls),
    });

    const result = await engine.run({
      images: [image("img-1", "image/png")],
      ocrTexts: ["제조 및 판매원 다른회사(주)"],
    });

    expect(result.identification.brand).toBe("다른회사(주)");
    const brandField = result.crossVerification.fields.find((f) => f.field === "brand");
    expect(brandField?.status).toBe("conflict");
    expect(brandField?.resolvedValue).toBeNull();
    expect(result.crossVerification.hasConflict).toBe(true);
  });

  it("Product Profile(STEP 4)은 GPT가 실제로 답한 그대로 보존하고, STEP 5(카피·HTML)는 교차 검증된 값만 쓴다 (T1-24)", async () => {
    const calls: Parameters<ProductProfileLlmClient>[0][] = [];
    const engine = new ProductProfileEngine({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "openai",
      complete: stubComplete({}, calls),
    });

    const result = await engine.run({
      images: [image("img-1", "image/png")],
      // GPT(validProfile)는 "Magic Clean"이라고 답하지만 OCR은 다른 브랜드를 말한다 — 충돌.
      ocrTexts: ["제조 및 판매원 다른회사(주)"],
    });

    // STEP 4 결과(profile)는 GPT 원본 브랜드를 그대로 보존한다 — 가공하지 않는다.
    expect(result.profile.brand).toBe(validProfile.brand);
    // 반면 STEP 5b(HTML)의 스펙 표에는 충돌로 확정되지 않은(null) 브랜드가
    // 아예 나타나지 않는다 — "브랜드" 행 자체가 만들어지지 않는다.
    expect(result.html).not.toContain("브랜드");
  });
});

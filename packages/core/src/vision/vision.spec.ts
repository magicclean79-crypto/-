import { MockLlmProvider } from "../llm/providers/mock.provider";
import { createDefaultPromptEngine } from "../prompt/default-engine";
import {
  LlmVisionProvider,
  VISION_MAX_IMAGES,
  type VisionCompanyBrainSource,
} from "./llm-vision.provider";
import type { VisionInput } from "./vision-provider";

const input: VisionInput = {
  project: { id: "proj-1", name: "매직클린 걸레", description: null },
  images: [
    {
      id: "img-1",
      mimeType: "image/png",
      getBytes: async () => new Uint8Array([1, 2, 3]),
    },
  ],
  ocrTexts: ["Magic Clean PVC Mat"],
};

const emptyCompanyBrain: VisionCompanyBrainSource = async () => ({
  knowledge: [],
  decisions: [],
  memories: [],
});

/** mock LLM(초안 JSON 에코)을 연결한 공식 Vision Provider — 오프라인 기본 구성과 동일 */
function createMockLlmVisionProvider(
  loadCompanyBrain: VisionCompanyBrainSource = emptyCompanyBrain,
): LlmVisionProvider {
  const llm = new MockLlmProvider();
  return new LlmVisionProvider({
    promptEngine: createDefaultPromptEngine(),
    llmProviderName: llm.name,
    complete: async (request) => {
      const result = await llm.complete(request);
      return { provider: result.provider, model: result.model, text: result.text };
    },
    loadCompanyBrain,
  });
}

describe("LlmVisionProvider", () => {
  it("이름은 'llm:<provider>'다", () => {
    expect(createMockLlmVisionProvider().name).toBe("llm:mock");
  });

  it("mock LLM 기준 — 초안(OCR 첫 줄)을 파싱한 VisionSummary를 반환한다", async () => {
    const { summary, raw } = await createMockLlmVisionProvider().analyze(input);

    expect(summary).toEqual({
      source: "llm:mock",
      labels: ["Magic", "Clean", "PVC", "Mat"],
      brand: null,
      category: "미분류",
      suggestedTitle: "Magic Clean PVC Mat",
      confidence: 0.3,
    });
    expect(raw).toMatchObject({
      provider: "llm:mock",
      llm: { provider: "mock" },
      imageCount: 1,
      omittedImageCount: 0,
    });
  });

  it("이미지 바이트를 읽어 base64로 LLM 요청에 첨부한다", async () => {
    const getBytes = jest.fn(async () => new Uint8Array([1, 2, 3]));
    const requests: { images: { mimeType: string; base64: string }[] }[] = [];
    const llm = new MockLlmProvider();
    const provider = new LlmVisionProvider({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: llm.name,
      complete: async (request) => {
        requests.push(request);
        const result = await llm.complete(request);
        return { provider: result.provider, model: result.model, text: result.text };
      },
      loadCompanyBrain: emptyCompanyBrain,
    });

    await provider.analyze({
      ...input,
      images: [{ id: "img-1", mimeType: "image/png", getBytes }],
    });

    expect(getBytes).toHaveBeenCalledTimes(1);
    expect(requests[0].images).toEqual([
      {
        mimeType: "image/png",
        base64: Buffer.from([1, 2, 3]).toString("base64"),
      },
    ]);
  });

  it(`이미지는 최대 ${VISION_MAX_IMAGES}장까지만 첨부한다`, async () => {
    const images = Array.from({ length: VISION_MAX_IMAGES + 2 }, (_, i) => ({
      id: `img-${i}`,
      mimeType: "image/png",
      getBytes: jest.fn(async () => new Uint8Array([i])),
    }));

    const { raw } = await createMockLlmVisionProvider().analyze({
      ...input,
      images,
    });

    expect(raw).toMatchObject({
      imageCount: VISION_MAX_IMAGES,
      omittedImageCount: 2,
    });
    expect(images[VISION_MAX_IMAGES].getBytes).not.toHaveBeenCalled();
  });

  it("Company Brain 컨텍스트를 로드해 raw에 반영한다", async () => {
    const loader = jest.fn(async () => ({
      knowledge: [
        { title: "브랜드 표기", content: "Magic Clean", category: "BRAND" },
      ],
      decisions: [],
      memories: [],
    }));

    const { raw } = await createMockLlmVisionProvider(loader).analyze(input);

    expect(loader).toHaveBeenCalledWith(input);
    expect(raw).toMatchObject({ companyBrain: { knowledgeCount: 1 } });
  });

  it("LLM 응답을 파싱할 수 없으면 reject한다 (호출자에서 재시도 후 null 폴백)", async () => {
    const provider = new LlmVisionProvider({
      promptEngine: createDefaultPromptEngine(),
      llmProviderName: "broken",
      complete: async () => ({
        provider: "broken",
        model: "broken-1",
        text: "JSON이 아닌 응답",
      }),
      loadCompanyBrain: emptyCompanyBrain,
    });

    await expect(provider.analyze(input)).rejects.toThrow(
      "JSON 객체를 찾을 수 없습니다",
    );
  });
});

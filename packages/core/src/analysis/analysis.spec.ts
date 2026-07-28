import { MockLlmProvider } from "../llm/providers/mock.provider";
import { createDefaultPromptEngine } from "../prompt/default-engine";
import { AnalysisExecutionService } from "./analysis-execution.service";
import type {
  AnalysisInput,
  AnalysisProvider,
  AnalysisRecognition,
  AnalysisRun,
  AnalysisRunStore,
} from "./analysis-provider";
import {
  LlmAnalysisProvider,
  type AnalysisCompanyBrainSource,
} from "./llm-analysis.provider";

class InMemoryAnalysisRunStore implements AnalysisRunStore {
  runs = new Map<string, AnalysisRun>();
  private sequence = 0;

  async start(productId: string, provider: string): Promise<AnalysisRun> {
    const run: AnalysisRun = {
      id: `run-${++this.sequence}`,
      productId,
      provider,
      status: "RUNNING",
      result: null,
      rawJson: null,
      error: null,
      attempts: 0,
      applied: false,
      startedAt: new Date(),
      completedAt: null,
    };
    this.runs.set(run.id, run);
    return { ...run };
  }

  async markSuccess(
    id: string,
    recognition: AnalysisRecognition,
    attempts: number,
  ): Promise<AnalysisRun> {
    const run = this.runs.get(id) as AnalysisRun;
    Object.assign(run, {
      status: "SUCCESS",
      result: recognition.analysis,
      rawJson: recognition.raw,
      attempts,
      completedAt: new Date(),
    });
    return { ...run };
  }

  async markFailed(
    id: string,
    error: string,
    attempts: number,
  ): Promise<AnalysisRun> {
    const run = this.runs.get(id) as AnalysisRun;
    Object.assign(run, {
      status: "FAILED",
      error,
      attempts,
      completedAt: new Date(),
    });
    return { ...run };
  }
}

const input: AnalysisInput = {
  product: {
    id: "prod-1",
    projectId: "proj-1",
    name: "테스트 상품",
    description: null,
  },
  images: [
    { id: "img-1", mimeType: "image/png", getBytes: async () => new Uint8Array(3) },
  ],
  ocrTexts: ["Magic Clean PVC Mat\nMade in Korea"],
};

const emptyCompanyBrain: AnalysisCompanyBrainSource = async () => ({
  knowledge: [],
  decisions: [],
  memories: [],
});

/** mock LLM(초안 JSON 에코)을 연결한 공식 분석 Provider — 오프라인 기본 구성과 동일 */
function createMockLlmAnalysisProvider(
  loadCompanyBrain: AnalysisCompanyBrainSource = emptyCompanyBrain,
): LlmAnalysisProvider {
  const llm = new MockLlmProvider();
  return new LlmAnalysisProvider({
    promptEngine: createDefaultPromptEngine(),
    llmProviderName: llm.name,
    complete: async (request) => {
      const result = await llm.complete(request);
      return { provider: result.provider, model: result.model, text: result.text };
    },
    loadCompanyBrain,
  });
}

describe("LlmAnalysisProvider", () => {
  it("이름은 'llm:<provider>'다", () => {
    expect(createMockLlmAnalysisProvider().name).toBe("llm:mock");
  });

  it("mock LLM 기준 — 초안(OCR 첫 줄 이름)을 파싱한 구조화 결과를 반환한다", async () => {
    const { analysis, raw } = await createMockLlmAnalysisProvider().analyze(
      input,
    );

    expect(analysis.name).toBe("Magic Clean PVC Mat");
    expect(analysis.category).toBe("미분류");
    expect(analysis.confidence).toBe(0.3);
    expect(analysis.attributes.imageCount).toBe("1");
    expect(raw).toMatchObject({
      provider: "llm:mock",
      llm: { provider: "mock" },
    });
  });

  it("OCR 텍스트가 없으면 상품 이름으로 대체한다", async () => {
    const { analysis } = await createMockLlmAnalysisProvider().analyze({
      ...input,
      ocrTexts: [],
    });
    expect(analysis.name).toBe("테스트 상품");
  });

  it("Company Brain 컨텍스트를 로드해 프롬프트와 raw에 반영한다", async () => {
    const loader = jest.fn(async () => ({
      knowledge: [
        { title: "브랜드 표기", content: "Magic Clean으로 표기", category: "BRAND" },
      ],
      decisions: [],
      memories: [],
    }));

    const { raw } = await createMockLlmAnalysisProvider(loader).analyze(input);

    expect(loader).toHaveBeenCalledWith(input);
    expect(raw).toMatchObject({ companyBrain: { knowledgeCount: 1 } });
  });

  it("LLM 응답을 파싱할 수 없으면 reject한다", async () => {
    const provider = new LlmAnalysisProvider({
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

describe("AnalysisExecutionService", () => {
  const noSleep = async (): Promise<void> => {};

  it("성공 시 SUCCESS 상태로 결과를 저장한다", async () => {
    const store = new InMemoryAnalysisRunStore();
    const service = new AnalysisExecutionService(
      createMockLlmAnalysisProvider(),
      store,
      { sleep: noSleep },
    );

    const run = await service.execute(input);

    expect(run.status).toBe("SUCCESS");
    expect(run.provider).toBe("llm:mock");
    expect(run.result?.name).toBe("Magic Clean PVC Mat");
    expect(run.attempts).toBe(1);
    expect(run.completedAt).not.toBeNull();
  });

  it("일시적 실패는 재시도 후 SUCCESS가 된다", async () => {
    let calls = 0;
    const flaky: AnalysisProvider = {
      name: "flaky",
      async analyze(value) {
        calls += 1;
        if (calls < 2) {
          throw new Error("일시적 오류");
        }
        return createMockLlmAnalysisProvider().analyze(value);
      },
    };
    const service = new AnalysisExecutionService(
      flaky,
      new InMemoryAnalysisRunStore(),
      { maxAttempts: 3, sleep: noSleep },
    );

    const run = await service.execute(input);

    expect(run.status).toBe("SUCCESS");
    expect(run.attempts).toBe(2);
  });

  it("최대 시도 초과 시 FAILED와 마지막 오류를 저장한다", async () => {
    const failing: AnalysisProvider = {
      name: "failing",
      async analyze() {
        throw new Error("모델 오류");
      },
    };
    const failures: number[] = [];
    const service = new AnalysisExecutionService(
      failing,
      new InMemoryAnalysisRunStore(),
      {
        maxAttempts: 3,
        sleep: noSleep,
        onAttemptFailed: (attempt) => failures.push(attempt),
      },
    );

    const run = await service.execute(input);

    expect(run.status).toBe("FAILED");
    expect(run.attempts).toBe(3);
    expect(run.error).toBe("모델 오류");
    expect(failures).toEqual([1, 2, 3]);
  });
});

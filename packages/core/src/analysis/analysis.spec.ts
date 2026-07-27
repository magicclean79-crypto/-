import { AnalysisExecutionService } from "./analysis-execution.service";
import type {
  AnalysisInput,
  AnalysisProvider,
  AnalysisRecognition,
  AnalysisRun,
  AnalysisRunStore,
} from "./analysis-provider";
import { MockAnalysisProvider } from "./providers/mock.provider";

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
  product: { id: "prod-1", name: "테스트 상품", description: null },
  images: [
    { id: "img-1", mimeType: "image/png", getBytes: async () => new Uint8Array(3) },
  ],
  ocrTexts: ["Magic Clean PVC Mat\nMade in Korea"],
};

describe("MockAnalysisProvider", () => {
  const provider = new MockAnalysisProvider();

  it("이름은 'mock'이다", () => {
    expect(provider.name).toBe("mock");
  });

  it("OCR 첫 줄을 상품 이름으로 사용한 구조화 결과를 반환한다", async () => {
    const { analysis, raw } = await provider.analyze(input);

    expect(analysis.name).toBe("Magic Clean PVC Mat");
    expect(analysis.category).toBe("생활용품");
    expect(analysis.confidence).toBe(0.95);
    expect(analysis.keywords).toContain("mock");
    expect(analysis.attributes.imageCount).toBe("1");
    expect(raw).toMatchObject({ provider: "mock" });
  });

  it("OCR 텍스트가 없으면 상품 이름으로 대체한다", async () => {
    const { analysis } = await provider.analyze({ ...input, ocrTexts: [] });
    expect(analysis.name).toBe("테스트 상품");
  });
});

describe("AnalysisExecutionService", () => {
  const noSleep = async (): Promise<void> => {};

  it("성공 시 SUCCESS 상태로 결과를 저장한다", async () => {
    const store = new InMemoryAnalysisRunStore();
    const service = new AnalysisExecutionService(
      new MockAnalysisProvider(),
      store,
      { sleep: noSleep },
    );

    const run = await service.execute(input);

    expect(run.status).toBe("SUCCESS");
    expect(run.provider).toBe("mock");
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
        return new MockAnalysisProvider().analyze(value);
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

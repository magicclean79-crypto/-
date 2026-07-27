import { OcrExecutionService } from "./ocr-execution.service";
import type {
  OcrProvider,
  OcrRecognition,
  OcrRun,
  OcrRunStore,
} from "./ocr-provider";
import { MockOcrProvider } from "./providers/mock.provider";

/** 단위 테스트용 인메모리 OcrRunStore */
class InMemoryOcrRunStore implements OcrRunStore {
  runs = new Map<string, OcrRun>();
  private sequence = 0;

  async start(imageId: string, provider: string): Promise<OcrRun> {
    const run: OcrRun = {
      id: `run-${++this.sequence}`,
      imageId,
      provider,
      status: "RUNNING",
      extractedText: null,
      confidence: null,
      rawJson: null,
      error: null,
      attempts: 0,
      startedAt: new Date(),
      completedAt: null,
    };
    this.runs.set(run.id, run);
    return { ...run };
  }

  async markSuccess(
    id: string,
    result: OcrRecognition,
    attempts: number,
  ): Promise<OcrRun> {
    const run = this.runs.get(id) as OcrRun;
    Object.assign(run, {
      status: "SUCCESS",
      extractedText: result.text,
      confidence: result.confidence,
      rawJson: result.raw,
      error: null,
      attempts,
      completedAt: new Date(),
    });
    return { ...run };
  }

  async markFailed(
    id: string,
    error: string,
    attempts: number,
  ): Promise<OcrRun> {
    const run = this.runs.get(id) as OcrRun;
    Object.assign(run, {
      status: "FAILED",
      error,
      attempts,
      completedAt: new Date(),
    });
    return { ...run };
  }
}

const noSleep = async (): Promise<void> => {};
const loadImage = async (): Promise<Uint8Array> => new Uint8Array([1, 2, 3]);

describe("OcrExecutionService", () => {
  it("성공 시 SUCCESS 상태로 결과를 저장한다", async () => {
    const store = new InMemoryOcrRunStore();
    const service = new OcrExecutionService(new MockOcrProvider(), store, {
      sleep: noSleep,
    });

    const run = await service.execute("img-1", "image/png", loadImage);

    expect(run.status).toBe("SUCCESS");
    expect(run.provider).toBe("mock");
    expect(run.extractedText).toBe("Magic Clean PVC Mat");
    expect(run.confidence).toBe(0.98);
    expect(run.attempts).toBe(1);
    expect(run.startedAt).not.toBeNull();
    expect(run.completedAt).not.toBeNull();
  });

  it("일시적 실패는 재시도 후 SUCCESS가 된다", async () => {
    let calls = 0;
    const flaky: OcrProvider = {
      name: "flaky",
      async recognize(image, mimeType) {
        calls += 1;
        if (calls < 3) {
          throw new Error("일시적 오류");
        }
        return new MockOcrProvider().recognize(image, mimeType);
      },
    };
    const store = new InMemoryOcrRunStore();
    const service = new OcrExecutionService(flaky, store, {
      maxAttempts: 3,
      sleep: noSleep,
    });

    const run = await service.execute("img-1", "image/png", loadImage);

    expect(run.status).toBe("SUCCESS");
    expect(run.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it("최대 시도 초과 시 FAILED와 마지막 오류를 저장한다", async () => {
    const failing: OcrProvider = {
      name: "failing",
      async recognize() {
        throw new Error("엔진 오류");
      },
    };
    const store = new InMemoryOcrRunStore();
    const failures: number[] = [];
    const service = new OcrExecutionService(failing, store, {
      maxAttempts: 3,
      sleep: noSleep,
      onAttemptFailed: (attempt) => failures.push(attempt),
    });

    const run = await service.execute("img-1", "image/png", loadImage);

    expect(run.status).toBe("FAILED");
    expect(run.attempts).toBe(3);
    expect(run.error).toBe("엔진 오류");
    expect(failures).toEqual([1, 2, 3]);
  });

  it("이미지 로드 실패는 재시도 없이 FAILED가 된다", async () => {
    const store = new InMemoryOcrRunStore();
    const service = new OcrExecutionService(new MockOcrProvider(), store, {
      sleep: noSleep,
    });

    const run = await service.execute("img-1", "image/png", async () => {
      throw new Error("스토리지 연결 실패");
    });

    expect(run.status).toBe("FAILED");
    expect(run.attempts).toBe(0);
    expect(run.error).toContain("이미지를 읽을 수 없습니다");
  });

  it("재시도 대기는 지수 백오프를 따른다", async () => {
    const delays: number[] = [];
    const failing: OcrProvider = {
      name: "failing",
      async recognize() {
        throw new Error("오류");
      },
    };
    const service = new OcrExecutionService(
      failing,
      new InMemoryOcrRunStore(),
      {
        maxAttempts: 3,
        retryBaseDelayMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    await service.execute("img-1", "image/png", loadImage);

    expect(delays).toEqual([100, 200]);
  });
});

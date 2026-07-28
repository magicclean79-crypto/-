import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockLlmProvider } from "@acos/core";
import type {
  ExecutionRecord,
  ExecutionStore,
  LlmProvider,
  NewExecution,
} from "@acos/core";
import { LLM_PROVIDER } from "./llm.constants";
import { LlmService } from "./llm.service";
import { createLlmProvider } from "./provider.factory";

class InMemoryExecutionStore implements ExecutionStore {
  entries: NewExecution[] = [];

  async record(entry: NewExecution): Promise<ExecutionRecord> {
    this.entries.push(entry);
    return { ...entry, id: `exec-${this.entries.length}`, createdAt: new Date() };
  }
}

describe("LlmService (Service Test)", () => {
  async function createService(provider: LlmProvider = new MockLlmProvider()) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: LLM_PROVIDER, useValue: provider },
      ],
    }).compile();
    return moduleRef.get(LlmService);
  }

  it("mock Provider로 완성 응답을 반환한다 (실제 API 미호출)", async () => {
    const service = await createService();

    const completion = await service.complete({
      messages: [
        { role: "system", content: "너는 상품 카피라이터다." },
        { role: "user", content: "매트 상세페이지 도입부를 써줘." },
      ],
    });

    expect(completion.provider).toBe("mock");
    expect(completion.model).toBe("mock-llm-1");
    expect(completion.text).toContain("매트 상세페이지 도입부");
    expect(completion.usage.inputTokens).toBeGreaterThan(0);
    expect(completion.createdAt).toBeTruthy();
  });

  it("검증 실패는 400 — 빈 메시지·잘못된 role·공백 content", async () => {
    const service = await createService();

    await expect(service.complete({ messages: [] })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.complete({
        messages: [{ role: "bot" as never, content: "hi" }],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.complete({ messages: [{ role: "user", content: " " }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it("model 덮어쓰기가 Provider에 전달된다", async () => {
    const service = await createService();
    const completion = await service.complete({
      messages: [{ role: "user", content: "hi" }],
      model: "custom-model",
    });
    expect(completion.model).toBe("custom-model");
  });

  it("info()가 선택된 Provider를 노출한다", async () => {
    const service = await createService();
    expect(service.info()).toEqual({
      provider: "mock",
      defaultModel: "mock-llm-1",
    });
  });
});

describe("LlmService — Execution 기록 (TASK-0601)", () => {
  const request = {
    messages: [{ role: "user" as const, content: "PVC 매트 소개 문구를 써줘." }],
  };

  it("호출 성공 시 feature가 태깅된 SUCCESS Execution을 기록한다", async () => {
    const store = new InMemoryExecutionStore();
    const service = new LlmService(new MockLlmProvider(), store);

    await service.complete(request, { feature: "content-generation" });

    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toMatchObject({
      feature: "content-generation",
      provider: "mock",
      model: "mock-llm-1",
      status: "SUCCESS",
      cost: 0,
      error: null,
    });
    expect(store.entries[0].inputTokens).toBeGreaterThan(0);
    expect(store.entries[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("feature 미지정 시 'dev'로 기록한다 (개발용 API 경로)", async () => {
    const store = new InMemoryExecutionStore();
    const service = new LlmService(new MockLlmProvider(), store);

    await service.complete(request);

    expect(store.entries[0].feature).toBe("dev");
  });

  it("호출 실패 시 FAILED Execution(폴백 provider/model + 오류)을 기록한다", async () => {
    const failing: LlmProvider = {
      name: "failing",
      defaultModel: "failing-1",
      complete: async () => {
        throw new Error("모델 오류");
      },
    };
    process.env.LLM_MAX_ATTEMPTS = "1";
    try {
      const store = new InMemoryExecutionStore();
      const service = new LlmService(failing, store);

      await expect(service.complete(request)).rejects.toThrow("모델 오류");

      expect(store.entries[0]).toMatchObject({
        feature: "dev",
        provider: "failing",
        model: "failing-1",
        status: "FAILED",
        inputTokens: null,
        cost: null,
        error: "모델 오류",
      });
    } finally {
      delete process.env.LLM_MAX_ATTEMPTS;
    }
  });

  it("검증 오류(400)는 LLM 호출이 아니므로 Execution을 기록하지 않는다", async () => {
    const store = new InMemoryExecutionStore();
    const service = new LlmService(new MockLlmProvider(), store);

    await expect(service.complete({ messages: [] })).rejects.toThrow(
      BadRequestException,
    );
    expect(store.entries).toHaveLength(0);
  });

  it("저장소 미주입 시(단독 구성) 기록 없이 호출만 수행한다", async () => {
    const service = new LlmService(new MockLlmProvider());
    const completion = await service.complete(request);
    expect(completion.text).toContain("[mock-llm]");
  });
});

describe("LlmService — Health Check (TASK-0603)", () => {
  it("정상 Provider면 ok + Execution(dev) 기록", async () => {
    const store = new InMemoryExecutionStore();
    const service = new LlmService(new MockLlmProvider(), store);

    const health = await service.health();

    expect(health).toMatchObject({
      provider: "mock",
      model: "mock-llm-1",
      status: "ok",
      error: null,
    });
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(store.entries[0]).toMatchObject({ feature: "dev", status: "SUCCESS" });
  });

  it("Provider 실패 시 예외 대신 error 상태를 반환하고 FAILED Execution을 기록한다", async () => {
    const failing: LlmProvider = {
      name: "openai",
      defaultModel: "gpt-4o",
      complete: async () => {
        throw new Error("401 Incorrect API key");
      },
    };
    process.env.LLM_MAX_ATTEMPTS = "1";
    try {
      const store = new InMemoryExecutionStore();
      const service = new LlmService(failing, store);

      const health = await service.health();

      expect(health).toMatchObject({
        provider: "openai",
        model: "gpt-4o",
        status: "error",
        error: "401 Incorrect API key",
      });
      expect(store.entries[0]).toMatchObject({
        feature: "dev",
        status: "FAILED",
        provider: "openai",
      });
    } finally {
      delete process.env.LLM_MAX_ATTEMPTS;
    }
  });
});

describe("createLlmProvider (Provider 선택 팩토리)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("기본은 mock — 실제 API를 호출하지 않는다", () => {
    delete process.env.LLM_PROVIDER;
    expect(createLlmProvider().name).toBe("mock");
  });

  it("키 없이 실제 Provider를 지정하면 mock으로 대체된다", () => {
    process.env.LLM_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    expect(createLlmProvider().name).toBe("mock");

    process.env.LLM_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    expect(createLlmProvider().name).toBe("mock");

    process.env.LLM_PROVIDER = "gemini";
    delete process.env.GEMINI_API_KEY;
    expect(createLlmProvider().name).toBe("mock");
  });

  it("키가 있으면 해당 Provider가 선택된다 (호출 없이 생성만 검증)", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(createLlmProvider().name).toBe("anthropic");

    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    expect(createLlmProvider().name).toBe("openai");

    process.env.LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key";
    expect(createLlmProvider().name).toBe("gemini");
  });

  it("알 수 없는 Provider 이름은 mock으로 대체된다", () => {
    process.env.LLM_PROVIDER = "unknown-llm";
    expect(createLlmProvider().name).toBe("mock");
  });
});

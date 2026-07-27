import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockLlmProvider } from "@acos/core";
import type { LlmProvider } from "@acos/core";
import { LLM_PROVIDER } from "./llm.constants";
import { LlmService } from "./llm.service";
import { createLlmProvider } from "./llm.module";

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

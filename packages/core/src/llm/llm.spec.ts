import { LlmGateway, LlmValidationError, validateLlmRequest } from "./llm-gateway";
import type { LlmProvider, LlmRequest, LlmResult } from "./llm-provider";
import { MockLlmProvider } from "./providers/mock.provider";

const request: LlmRequest = {
  messages: [
    { role: "system", content: "너는 상품 카피라이터다." },
    { role: "user", content: "PVC 매트 상세페이지 도입부를 써줘." },
  ],
};

describe("MockLlmProvider", () => {
  it("실제 API 호출 없이 결정적 응답을 생성한다 (마지막 user 반영)", async () => {
    const provider = new MockLlmProvider();

    const first = await provider.complete(request);
    const second = await provider.complete(request);

    expect(first.provider).toBe("mock");
    expect(first.model).toBe("mock-llm-1");
    expect(first.text).toContain("PVC 매트 상세페이지 도입부");
    expect(first.text).toContain("[mock-llm]");
    expect(first).toEqual(second); // 결정적
    expect(first.usage.inputTokens).toBeGreaterThan(0);
  });

  it("model 지정 시 해당 모델명이 결과에 반영된다", async () => {
    const provider = new MockLlmProvider();
    const result = await provider.complete({ ...request, model: "my-model" });
    expect(result.model).toBe("my-model");
  });
});

describe("LlmGateway", () => {
  it("요청 검증 — 빈 메시지·잘못된 role·공백 content·잘못된 maxTokens", async () => {
    const gateway = new LlmGateway(new MockLlmProvider());

    await expect(gateway.complete({ messages: [] })).rejects.toBeInstanceOf(
      LlmValidationError,
    );

    expect(validateLlmRequest({ messages: [] })).toHaveLength(1);
    expect(
      validateLlmRequest({
        messages: [{ role: "bot" as never, content: "hi" }],
      }),
    ).toHaveLength(1);
    expect(
      validateLlmRequest({ messages: [{ role: "user", content: " " }] }),
    ).toHaveLength(1);
    expect(
      validateLlmRequest({
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 0,
      }),
    ).toHaveLength(1);
    expect(validateLlmRequest(request)).toEqual([]);
  });

  it("Provider 실패 시 지수 백오프로 재시도한다", async () => {
    let attempts = 0;
    const flaky: LlmProvider = {
      name: "flaky",
      defaultModel: "flaky-1",
      async complete(): Promise<LlmResult> {
        attempts += 1;
        if (attempts < 3) throw new Error(`실패 ${attempts}`);
        return {
          provider: "flaky",
          model: "flaky-1",
          text: "성공",
          usage: { inputTokens: null, outputTokens: null },
          raw: null,
        };
      },
    };
    const delays: number[] = [];
    const gateway = new LlmGateway(flaky, {
      maxAttempts: 3,
      retryBaseDelayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    const result = await gateway.complete(request);

    expect(result.text).toBe("성공");
    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]); // 지수 백오프
  });

  it("모든 시도 실패 시 마지막 오류를 던진다", async () => {
    const failing: LlmProvider = {
      name: "down",
      defaultModel: "down-1",
      async complete(): Promise<LlmResult> {
        throw new Error("provider down");
      },
    };
    const gateway = new LlmGateway(failing, {
      maxAttempts: 2,
      sleep: async () => {},
    });

    await expect(gateway.complete(request)).rejects.toThrow("provider down");
  });

  it("providerName/defaultModel로 선택된 Provider를 노출한다", () => {
    const gateway = new LlmGateway(new MockLlmProvider());
    expect(gateway.providerName).toBe("mock");
    expect(gateway.defaultModel).toBe("mock-llm-1");
  });
});

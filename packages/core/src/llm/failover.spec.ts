import {
  buildFailoverChain,
  isFailoverEligible,
  LlmTimeoutError,
  markNoFailover,
  ProviderHealthTracker,
  withTimeout,
} from "./failover";
import { LlmValidationError } from "./llm-gateway";

describe("Provider Failover (TASK-1002)", () => {
  describe("Failover 대상 판정", () => {
    it("Validation 오류·NO_FAILOVER 표시는 제외 (CTO 지시)", () => {
      expect(isFailoverEligible(new LlmValidationError(["잘못된 요청"]))).toBe(
        false,
      );
      const budget = markNoFailover(new Error("예산 초과"));
      expect(isFailoverEligible(budget)).toBe(false);
    });

    it("그 외 실행 오류는 Failover 대상", () => {
      expect(isFailoverEligible(new Error("503 Service Unavailable"))).toBe(
        true,
      );
      expect(isFailoverEligible(new LlmTimeoutError("openai", 1000))).toBe(true);
      expect(isFailoverEligible("문자열 오류")).toBe(true);
    });
  });

  describe("Timeout Policy", () => {
    it("제한 시간을 넘기면 LlmTimeoutError", async () => {
      await expect(
        withTimeout(() => new Promise((resolve) => setTimeout(resolve, 50)), {
          timeoutMs: 10,
          provider: "openai",
        }),
      ).rejects.toBeInstanceOf(LlmTimeoutError);
    });

    it("제한 시간 안에 끝나면 결과를 그대로 반환하고, 0이면 무제한", async () => {
      await expect(
        withTimeout(async () => "ok", { timeoutMs: 100, provider: "openai" }),
      ).resolves.toBe("ok");
      await expect(
        withTimeout(async () => "무제한", { timeoutMs: 0, provider: "openai" }),
      ).resolves.toBe("무제한");
    });
  });

  describe("Provider Priority 체인", () => {
    const available = ["mock", "openai", "anthropic"];

    it("primary가 먼저, 그다음 우선순위 — 중복·미가용은 제외", () => {
      expect(
        buildFailoverChain({
          primary: "anthropic",
          priority: ["openai", "anthropic", "gemini"], // gemini 미가용
          available,
        }),
      ).toEqual(["anthropic", "openai"]);
    });

    it("우선순위가 비면 primary만 시도한다 (Failover 비활성)", () => {
      expect(
        buildFailoverChain({ primary: "mock", priority: [], available }),
      ).toEqual(["mock"]);
    });

    it("불건강한 Provider는 제외하지 않고 뒤로 민다", () => {
      const chain = buildFailoverChain({
        primary: "openai",
        priority: ["anthropic", "mock"],
        available,
        isHealthy: (provider) => provider !== "openai",
      });
      expect(chain).toEqual(["anthropic", "mock", "openai"]);
    });
  });

  describe("Health Check Integration", () => {
    it("연속 실패 임계 도달 시 불건강 → 쿨다운 후 회복", () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        cooldownMs: 1000,
      });
      const t0 = 1_000_000;

      expect(tracker.isHealthy("openai", t0)).toBe(true);
      tracker.recordFailure("openai", t0);
      expect(tracker.isHealthy("openai", t0)).toBe(true); // 1회
      tracker.recordFailure("openai", t0 + 10);
      expect(tracker.isHealthy("openai", t0 + 10)).toBe(false); // 임계 도달
      expect(tracker.isHealthy("openai", t0 + 500)).toBe(false); // 쿨다운 중
      expect(tracker.isHealthy("openai", t0 + 1010)).toBe(true); // 쿨다운 경과
    });

    it("성공하면 즉시 회복하고 카운터가 초기화된다", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      tracker.recordFailure("gemini");
      tracker.recordFailure("gemini");
      expect(tracker.isHealthy("gemini")).toBe(false);

      tracker.recordSuccess("gemini");
      expect(tracker.isHealthy("gemini")).toBe(true);
      expect(tracker.snapshot(["gemini"])[0].consecutiveFailures).toBe(0);
    });

    it("snapshot은 상태·쿨다운 종료 시각을 보고한다", () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 1,
        cooldownMs: 60_000,
      });
      const now = Date.parse("2026-07-28T12:00:00.000Z");
      tracker.recordFailure("anthropic", now);

      const [state] = tracker.snapshot(["anthropic"], now);
      expect(state).toMatchObject({
        provider: "anthropic",
        healthy: false,
        consecutiveFailures: 1,
        lastFailureAt: "2026-07-28T12:00:00.000Z",
        cooldownUntil: "2026-07-28T12:01:00.000Z",
      });
      // 기록이 없는 Provider는 건강 상태로 보고된다
      expect(tracker.snapshot(["mock"], now)[0]).toMatchObject({
        healthy: true,
        consecutiveFailures: 0,
        cooldownUntil: null,
      });
    });
  });
});

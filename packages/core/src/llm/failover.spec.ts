import {
  buildFailoverChain,
  classifyFailoverError,
  isFailoverEligible,
  LlmTimeoutError,
  markNoFailover,
  ProviderHealthTracker,
  withTimeout,
} from "./failover";
import { LlmValidationError } from "./llm-gateway";

describe("Provider Failover (TASK-1002)", () => {
  /**
   * 오류 분류는 CTO 결정 1002-①로 확정된 목록을 그대로 따른다.
   * 대상: Timeout · Provider 5xx · Rate Limit · 일시적 네트워크 오류
   * 제외: Budget · Validation · 인증(401/403) · 잘못된 API Key · 잘못된 요청
   */
  describe("Failover 대상 판정 (CTO 결정 1002-①)", () => {
    it("Timeout · 5xx · Rate Limit · 네트워크 오류만 대상", () => {
      const eligible: [string, unknown][] = [
        ["timeout", new LlmTimeoutError("openai", 1000)],
        ["timeout(408)", Object.assign(new Error("요청 시간 초과"), { status: 408 })],
        ["server_error(503)", Object.assign(new Error("서버 오류"), { status: 503 })],
        ["server_error(메시지)", new Error("503 Service Unavailable")],
        ["rate_limit(429)", Object.assign(new Error("과다 호출"), { status: 429 })],
        ["rate_limit(메시지)", new Error("Rate limit reached for gpt-4o")],
        ["network(code)", Object.assign(new Error("소켓 오류"), { code: "ECONNRESET" })],
        ["network(메시지)", new Error("fetch failed")],
      ];
      for (const [label, error] of eligible) {
        expect([label, isFailoverEligible(error)]).toEqual([label, true]);
      }
    });

    it("Budget · Validation · 인증 · 잘못된 API Key · 잘못된 요청은 제외", () => {
      const excluded: [string, unknown, string][] = [
        ["budget", markNoFailover(new Error("예산 초과")), "budget"],
        ["validation", new LlmValidationError(["잘못된 요청"]), "validation"],
        ["auth(401)", Object.assign(new Error("인증 실패"), { status: 401 }), "auth"],
        ["auth(403)", Object.assign(new Error("권한 없음"), { status: 403 }), "auth"],
        ["invalid key", new Error("Incorrect API key provided"), "auth"],
        [
          "invalid request(400)",
          Object.assign(new Error("잘못된 파라미터"), { status: 400 }),
          "invalid_request",
        ],
        ["invalid request(메시지)", new Error("Invalid request: unsupported model"), "invalid_request"],
      ];
      for (const [label, error, kind] of excluded) {
        expect([label, classifyFailoverError(error)]).toEqual([label, kind]);
        expect([label, isFailoverEligible(error)]).toEqual([label, false]);
      }
    });

    it("분류할 수 없는 오류는 안전하게 제외한다 (unknown)", () => {
      expect(classifyFailoverError("문자열 오류")).toBe("unknown");
      expect(classifyFailoverError(new Error("알 수 없는 문제"))).toBe("unknown");
      expect(isFailoverEligible(new Error("알 수 없는 문제"))).toBe(false);
    });

    it("SDK 예외의 response.status도 인식한다", () => {
      const error = Object.assign(new Error("오류"), {
        response: { status: 502 },
      });
      expect(classifyFailoverError(error)).toBe("server_error");
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

import {
  detectBudgetAlerts,
  detectConfigurationAlerts,
  detectProviderAlerts,
  detectUnpricedAlerts,
  reconcileAlerts,
  summarizeAlerts,
} from "./alerts";
import type { AlertState, DetectedAlert } from "./alerts";

const OFF = { budget: null, spend: 0, ratio: null, status: "off" };

function alert(overrides: Partial<DetectedAlert> = {}): DetectedAlert {
  return {
    kind: overrides.kind ?? "provider-failure",
    key: overrides.key ?? "provider-failure:openai",
    level: overrides.level ?? "warning",
    title: overrides.title ?? "제목",
    message: overrides.message ?? "설명",
  };
}

describe("Production Alerting (TASK-1302)", () => {
  describe("Budget Alert", () => {
    it("경고 임계는 warning, 초과는 critical", () => {
      const alerts = detectBudgetAlerts({
        daily: { budget: 10, spend: 8.5, ratio: 0.85, status: "alert" },
        monthly: { budget: 50, spend: 60, ratio: 1.2, status: "exceeded" },
        alertRatio: 0.8,
      });
      expect(alerts.map((entry) => [entry.key, entry.level])).toEqual([
        ["budget:daily", "warning"],
        ["budget:monthly", "critical"],
      ]);
      expect(alerts[1].message).toContain("차단");
    });

    it("예산이 없으면 경보하지 않는다 — 넘을 상한이 없다", () => {
      expect(
        detectBudgetAlerts({ daily: OFF, monthly: OFF, alertRatio: 0.8 }),
      ).toEqual([]);
    });

    it("정상 범위는 경보하지 않는다", () => {
      expect(
        detectBudgetAlerts({
          daily: { budget: 10, spend: 1, ratio: 0.1, status: "ok" },
          monthly: OFF,
          alertRatio: 0.8,
        }),
      ).toEqual([]);
    });
  });

  describe("Provider Failure Alert", () => {
    it("degraded는 warning, down은 critical", () => {
      const alerts = detectProviderAlerts([
        {
          provider: "openai",
          status: "degraded",
          calls: 10,
          successCount: 7,
          successRate: 0.7,
        },
        {
          provider: "gemini",
          status: "down",
          calls: 10,
          successCount: 0,
          successRate: 0,
        },
      ]);
      expect(alerts.map((entry) => entry.level)).toEqual([
        "warning",
        "critical",
      ]);
      expect(alerts[0].message).toContain("70%");
    });

    it("판정 불가(unknown)는 경보하지 않는다 — 모르는 것을 문제라 하지 않는다", () => {
      expect(
        detectProviderAlerts([
          {
            provider: "openai",
            status: "unknown",
            calls: 1,
            successCount: 0,
            successRate: 0,
          },
          {
            provider: "mock",
            status: "healthy",
            calls: 50,
            successCount: 50,
            successRate: 1,
          },
        ]),
      ).toEqual([]);
    });
  });

  describe("Unpriced Model Alert", () => {
    it("unpriced만 경보하고, 차단하지 않음을 명시한다 (CTO 결정 1301-⑤)", () => {
      const alerts = detectUnpricedAlerts([
        { kind: "unpriced", provider: "openai", model: "gpt-5-preview", count: 12 },
        { kind: "mismatch", provider: "openai", model: "gpt-4o", count: 2 },
        { kind: "missing-usage", provider: "openai", model: "gpt-4o", count: 1 },
      ]);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].key).toBe("unpriced-model:openai:gpt-5-preview");
      expect(alerts[0].message).toContain("예산 상한");
      expect(alerts[0].message).toContain("차단하지 않습니다");
    });
  });

  describe("Configuration Alert", () => {
    it("환경 오류와 Provider blocker를 각각 키로 구분한다", () => {
      const alerts = detectConfigurationAlerts({
        envErrors: [{ name: "S3_BUCKET", message: "필수 환경변수가 없습니다." }],
        providerBlockers: ["openai: 플레이스홀더로 보이는 값입니다."],
      });
      expect(alerts.map((entry) => entry.key)).toEqual([
        "configuration:env:S3_BUCKET",
        "configuration:provider:openai",
      ]);
      expect(alerts.every((entry) => entry.level === "critical")).toBe(true);
    });

    it("문제가 없으면 경보도 없다", () => {
      expect(
        detectConfigurationAlerts({ envErrors: [], providerBlockers: [] }),
      ).toEqual([]);
    });
  });

  describe("reconcileAlerts — 중복·해소 판정", () => {
    const now = 1_000_000;
    const cooldownMs = 60_000;

    it("처음 감지되면 raise", () => {
      const [decision] = reconcileAlerts([alert()], [], { cooldownMs, now });
      expect(decision).toMatchObject({ action: "raise", notify: true });
    });

    it("이미 알린 경보는 쿨다운 안에서 억제한다 — 반복되면 사람이 무시한다", () => {
      const state: AlertState = {
        key: "provider-failure:openai",
        level: "warning",
        status: "ACTIVE",
        notifiedAt: now - 10_000,
      };
      const [decision] = reconcileAlerts([alert()], [state], { cooldownMs, now });
      expect(decision).toMatchObject({ action: "suppress", notify: false });
    });

    it("쿨다운이 지나면 다시 알린다", () => {
      const state: AlertState = {
        key: "provider-failure:openai",
        level: "warning",
        status: "ACTIVE",
        notifiedAt: now - 120_000,
      };
      const [decision] = reconcileAlerts([alert()], [state], { cooldownMs, now });
      expect(decision).toMatchObject({ action: "repeat", notify: true });
    });

    it("심각도가 올라가면 쿨다운과 무관하게 알린다", () => {
      const state: AlertState = {
        key: "provider-failure:openai",
        level: "warning",
        status: "ACTIVE",
        notifiedAt: now - 1_000,
      };
      const [decision] = reconcileAlerts(
        [alert({ level: "critical" })],
        [state],
        { cooldownMs, now },
      );
      expect(decision).toMatchObject({ action: "raise", notify: true });
      expect(decision.reason).toContain("심각도");
    });

    it("해소됐던 경보가 재발하면 raise", () => {
      const state: AlertState = {
        key: "provider-failure:openai",
        level: "warning",
        status: "RESOLVED",
        notifiedAt: now - 1_000,
      };
      const [decision] = reconcileAlerts([alert()], [state], { cooldownMs, now });
      expect(decision.action).toBe("raise");
      expect(decision.reason).toContain("다시 발생");
    });

    it("감지되지 않은 활성 경보는 해소로 처리하고 알린다", () => {
      const state: AlertState = {
        key: "budget:daily",
        level: "critical",
        status: "ACTIVE",
        notifiedAt: now - 1_000,
      };
      const decisions = reconcileAlerts([], [state], { cooldownMs, now });
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        action: "resolve",
        notify: true,
        alert: null,
      });
    });

    it("이미 해소된 경보는 다시 해소하지 않는다", () => {
      const state: AlertState = {
        key: "budget:daily",
        level: "critical",
        status: "RESOLVED",
        notifiedAt: now,
      };
      expect(reconcileAlerts([], [state], { cooldownMs, now })).toEqual([]);
    });

    it("한 번도 알린 적 없는 활성 경보는 쿨다운을 기다리지 않는다", () => {
      const state: AlertState = {
        key: "provider-failure:openai",
        level: "warning",
        status: "ACTIVE",
        notifiedAt: null,
      };
      const [decision] = reconcileAlerts([alert()], [state], { cooldownMs, now });
      expect(decision).toMatchObject({ action: "repeat", notify: true });
    });
  });

  describe("summarizeAlerts", () => {
    it("critical이 하나라도 있으면 ok=false", () => {
      expect(
        summarizeAlerts([{ level: "warning" }, { level: "critical" }]),
      ).toEqual({ total: 2, critical: 1, warning: 1, ok: false });
      expect(summarizeAlerts([])).toEqual({
        total: 0,
        critical: 0,
        warning: 0,
        ok: true,
      });
    });
  });
});

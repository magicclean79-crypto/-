import {
  DEFAULT_ALERT_COOLDOWN_MS,
  detectBudgetAlerts,
  detectConfigurationAlerts,
  detectForecastAlerts,
  detectLockOutageAlert,
  detectPriceSourceAlerts,
  DEFAULT_PRICE_SOURCE_ESCALATE_MS,
  judgePriceSourceEscalation,
  resolvePriceSourceEscalateMs,
  detectPricingDriftAlerts,
  detectSchedulerAlerts,
  detectProviderAlerts,
  detectUnpricedAlerts,
  reconcileAlerts,
  resolveCooldowns,
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

  describe("Pricing Drift Alert (TASK-3201, CTO 정책 3201-①)", () => {
    const change = {
      target: "ocr",
      key: "google-vision",
      impliedPrice: { perUnitUsd: 0.002 },
      currentPrice: { perUnitUsd: 0.0015 },
      samples: 5,
    };

    it("감지된 변경을 알리고, 승인이 필요하다고 말한다", () => {
      // 감지만 하고 알리지 않으면 제안이 쌓인 채 아무도 모른다 —
      // 자동화가 "돌지만 아무 일도 하지 않는" 상태가 된다
      const alerts = detectPricingDriftAlerts({ changes: [change], unresolved: [] });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].key).toBe("pricing-drift:ocr:google-vision");
      expect(alerts[0].message).toContain("승인 후 적용해 주세요");
      // 감지는 적용이 아니고, 차단도 아니다
      expect(alerts[0].message).toContain("감지만으로 단가가 바뀌지는 않으며");
      expect(alerts[0].message).toContain("차단하지도 않습니다");
    });

    it("단가를 가를 수 없는 어긋남은 직접 제안을 내라고 말한다", () => {
      const alerts = detectPricingDriftAlerts({
        changes: [],
        unresolved: [
          { target: "llm", key: "gpt-4o", provider: "openai", samples: 7 },
        ],
      });
      expect(alerts[0].key).toBe("pricing-drift:llm:gpt-4o");
      expect(alerts[0].message).toContain("제안을 만들지 않았습니다");
      expect(alerts[0].message).toContain("직접 제안을 내주세요");
    });

    it("아무것도 없으면 조용하다", () => {
      expect(detectPricingDriftAlerts({ changes: [], unresolved: [] })).toEqual([]);
    });

    it("경보 수준은 warning이다 — 돈이 새는 것이 아니라 기준이 낡은 것이다", () => {
      expect(
        detectPricingDriftAlerts({ changes: [change], unresolved: [] })[0].level,
      ).toBe("warning");
    });
  });

  describe("Price Source Alert (TASK-3301, CTO 정책 3301-①)", () => {
    it("읽지 못하면 사람 확인을 요구한다 — 변경 없음이 아니다", () => {
      const alerts = detectPriceSourceAlerts({
        status: "unparsable",
        needsHumanCheck: true,
        unparsedCount: 3,
        detail: "가격 공지를 해석할 수 없습니다 — 목록이 아닙니다.",
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].key).toBe("price-source:pricing-feed");
      expect(alerts[0].title).toContain("읽지 못했습니다");
      expect(alerts[0].message).toContain("해석하지 못한 항목 3건");
      expect(alerts[0].message).toContain("사람이 공지를 직접 확인해 주세요");
    });

    it("미구성은 실패와 다른 제목으로 말한다", () => {
      // 실패와 같은 무게로 부르면 진짜 실패가 묻힌다
      const alerts = detectPriceSourceAlerts({
        status: "unconfigured",
        needsHumanCheck: true,
        unparsedCount: 0,
        detail: "가격 공지 주소가 설정되지 않았습니다.",
      });
      expect(alerts[0].title).toContain("설정되지 않았습니다");
      expect(alerts[0].title).not.toContain("읽지 못했습니다");
    });

    it("전부 읽었으면 조용하다", () => {
      expect(
        detectPriceSourceAlerts({
          status: "ok",
          needsHumanCheck: false,
          unparsedCount: 0,
          detail: "가격 공지 3건을 읽었습니다.",
        }),
      ).toEqual([]);
    });

    it("일부만 읽어도 부른다 — 못 읽은 것이 사라지면 안 된다", () => {
      expect(
        detectPriceSourceAlerts({
          status: "partial",
          needsHumanCheck: true,
          unparsedCount: 1,
          detail: "2건을 읽었고 1건은 해석하지 못했습니다.",
        }),
      ).toHaveLength(1);
    });

    it("키가 하나다 — 같은 사안이 상태별로 흩어지지 않는다", () => {
      const keys = ["unreachable", "unparsable", "partial"].map(
        (status) =>
          detectPriceSourceAlerts({
            status,
            needsHumanCheck: true,
            unparsedCount: 0,
            detail: "d",
          })[0].key,
      );
      expect(new Set(keys).size).toBe(1);
    });
  });

  describe("Cost Forecast Alert (TASK-3201, CTO 정책 3201-④)", () => {
    const projected = {
      verdict: "projected",
      projectedMonthEnd: 300,
      projectedRatio: 3,
      projectedExceeds: true,
      budget: 100,
      observedDays: 5,
    };

    it("이 추세면 넘는다고 알리되, 차단하지 않는다고 못 박는다", () => {
      const alerts = detectForecastAlerts(projected);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].key).toBe("cost-forecast:monthly");
      expect(alerts[0].message).toContain("차단하지 않습니다");
      expect(alerts[0].message).toContain("CTO 정책 3201-④");
      // 무엇을 하면 되는지도 말한다
      expect(alerts[0].message).toContain("예산 상향 또는 사용량 조정");
    });

    it("예산 안에 들어오면 경보하지 않는다", () => {
      expect(
        detectForecastAlerts({ ...projected, projectedExceeds: false }),
      ).toEqual([]);
    });

    it("표본이 부족하면 경보하지 않는다 — 짐작으로 사람을 부르지 않는다", () => {
      expect(
        detectForecastAlerts({
          ...projected,
          verdict: "insufficient",
          projectedMonthEnd: null,
          projectedRatio: null,
          projectedExceeds: false,
        }),
      ).toEqual([]);
    });

    it("예산이 없으면 넘을 것도 없다", () => {
      expect(
        detectForecastAlerts({ ...projected, budget: null, projectedRatio: null }),
      ).toEqual([]);
    });

    it("키가 하나다 — 같은 사안이 여러 경보로 흩어지지 않는다", () => {
      const twice = [
        ...detectForecastAlerts(projected),
        ...detectForecastAlerts(projected),
      ];
      expect(new Set(twice.map((entry) => entry.key)).size).toBe(1);
    });

    it("마크다운 강조가 새지 않는다", () => {
      expect(detectForecastAlerts(projected)[0].message).not.toContain("**");
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

  describe("Scheduler Stopped Alert (CTO 결정 1401-①)", () => {
    const job = {
      job: "cost-verification",
      stopped: true,
      lastRunAt: "2026-07-29T00:00:00.000Z",
      interval: "15분",
    };

    it("멈춘 점검만 critical로 알린다", () => {
      const alerts = detectSchedulerAlerts({
        jobs: [job, { ...job, job: "health-check", stopped: false }],
        lockUnavailable: false,
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        kind: "scheduler-stopped",
        key: "scheduler-stopped:cost-verification",
        level: "critical",
      });
      expect(alerts[0].message).toContain("15분");
    });

    it("Redis를 못 쓰는 상황이면 원인을 함께 적는다", () => {
      // 원인을 모르면 사람이 어디부터 봐야 할지 알 수 없다
      const [alert] = detectSchedulerAlerts({
        jobs: [job],
        lockUnavailable: true,
      });
      expect(alert.message).toContain("분산 잠금(Redis)");
      expect(alert.message).toContain("Redis 연결을 먼저 확인");
    });

    it("실행 이력이 없으면 그 사실을 말한다", () => {
      const [alert] = detectSchedulerAlerts({
        jobs: [{ ...job, lastRunAt: null }],
        lockUnavailable: false,
      });
      expect(alert.message).toContain("실행 이력이 없습니다");
    });

    it("멈춘 점검이 없으면 경보도 없다", () => {
      expect(
        detectSchedulerAlerts({
          jobs: [{ ...job, stopped: false }],
          lockUnavailable: true,
        }),
      ).toEqual([]);
    });
  });

  describe("Redis 장애 지속 경보 (CTO 결정 1501-②)", () => {
    const now = 10 * 60 * 60 * 1000;

    it("정상이면 경보 없음", () => {
      expect(detectLockOutageAlert({ unhealthySince: null, now })).toEqual([]);
    });

    it("짧은 끊김은 알리지 않는다 — 대개 스스로 복구된다", () => {
      expect(
        detectLockOutageAlert({ unhealthySince: now - 10 * 60_000, now }),
      ).toEqual([]);
    });

    it("30분 이상 지속되면 critical", () => {
      const [alert] = detectLockOutageAlert({
        unhealthySince: now - 31 * 60_000,
        now,
      });
      expect(alert).toMatchObject({
        kind: "scheduler-stopped",
        key: "scheduler-stopped:lock",
        level: "critical",
      });
      expect(alert.message).toContain("31분 넘게");
      // LLM 호출은 계속되므로 그 사실을 말한다 (결정 1501-②)
      expect(alert.message).toContain("비용은 나가는데 비용 점검은 멈춘 상태");
      // 마크다운 강조는 Slack·메일·화면에서 별표가 그대로 보인다 (1302 라이브 결함 재발 방지)
      expect(alert.message).not.toContain("**");
    });

    it("1분 미만이어도 '0분째'라고 하지 않는다", () => {
      // 한계값을 짧게 잡은 구성에서 상태와 설명이 어긋나면 안 된다
      const [alert] = detectLockOutageAlert({
        unhealthySince: now - 10_000,
        now,
        thresholdMs: 5_000,
      });
      expect(alert.message).toContain("1분 넘게");
      expect(alert.message).not.toContain("0분");
    });

    it("한계는 조정할 수 있다", () => {
      expect(
        detectLockOutageAlert({
          unhealthySince: now - 5 * 60_000,
          now,
          thresholdMs: 60_000,
        }),
      ).toHaveLength(1);
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

    describe("범위별 독립 판정 (TASK-2801, CTO 결정 2701-④)", () => {
      const active = (key: string, notifiedAt = now - 1_000): AlertState => ({
        key,
        level: "warning",
        status: "ACTIVE",
        notifiedAt,
      });
      const scan = (key: string) =>
        alert({ kind: "governance-scan", key, level: "warning" });

      it("판정하지 않은 범위의 경보는 해소하지 않는다", () => {
        // 프로젝트 A만 훑은 실행이 B의 경보를 해소하면 **B의 위반은 그대로인데
        // 화면에서 사라진다** — 같은 kind라는 것만으로 함께 지워선 안 된다
        const decisions = reconcileAlerts(
          [],
          [active("governance-scan:violations:project:a"), active("governance-scan:violations:project:b")],
          {
            cooldownMs,
            now,
            resolvableKeys: ["governance-scan:violations:project:a"],
          },
        );
        expect(decisions).toHaveLength(1);
        expect(decisions[0]).toMatchObject({
          key: "governance-scan:violations:project:a",
          action: "resolve",
        });
      });

      it("빈 목록을 넘기면 아무것도 해소하지 않는다", () => {
        expect(
          reconcileAlerts([], [active("governance-scan:violations:all")], {
            cooldownMs,
            now,
            resolvableKeys: [],
          }),
        ).toEqual([]);
      });

      it("넘기지 않으면 기존 동작 그대로 전체가 대상이다", () => {
        expect(
          reconcileAlerts([], [active("governance-scan:violations:all")], {
            cooldownMs,
            now,
          }),
        ).toHaveLength(1);
      });

      it("재알림 간격은 범위마다 따로 흐른다", () => {
        // 방금 알린 A는 억제되고, 오래된 B는 다시 알린다 — 한 프로젝트의
        // 알림이 다른 프로젝트를 조용하게 만들면 안 된다
        const decisions = reconcileAlerts(
          [
            scan("governance-scan:violations:project:a"),
            scan("governance-scan:violations:project:b"),
          ],
          [
            active("governance-scan:violations:project:a", now - 1_000),
            active("governance-scan:violations:project:b", now - 600_000),
          ],
          { cooldownMs, now },
        );
        expect(decisions.map((decision) => decision.action)).toEqual([
          "suppress",
          "repeat",
        ]);
      });

      it("해소 범위를 좁혀도 감지된 경보는 그대로 올린다", () => {
        const decisions = reconcileAlerts(
          [scan("governance-scan:violations:project:b")],
          [active("governance-scan:violations:project:a")],
          {
            cooldownMs,
            now,
            resolvableKeys: ["governance-scan:violations:project:b"],
          },
        );
        expect(decisions).toHaveLength(1);
        expect(decisions[0]).toMatchObject({
          key: "governance-scan:violations:project:b",
          action: "raise",
        });
      });
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

  describe("resolveCooldowns (CTO 결정 1302-①)", () => {
    it("미설정이면 전 종류 30분 — 공식 표준", () => {
      const resolved = resolveCooldowns({});
      expect(resolved.budget).toBe(DEFAULT_ALERT_COOLDOWN_MS);
      expect(resolved["scheduler-stopped"]).toBe(DEFAULT_ALERT_COOLDOWN_MS);
      expect(DEFAULT_ALERT_COOLDOWN_MS).toBe(30 * 60 * 1000);
      expect(Object.values(resolved).every((ms) => ms === 1_800_000)).toBe(true);
    });

    it("전체 기본값을 바꾸면 전 종류에 적용된다", () => {
      const resolved = resolveCooldowns({ ALERT_COOLDOWN_MS: "600000" });
      expect(resolved["provider-failure"]).toBe(600_000);
      expect(resolved.configuration).toBe(600_000);
    });

    it("종류별 값이 전체 기본값보다 우선한다", () => {
      const resolved = resolveCooldowns({
        ALERT_COOLDOWN_MS: "600000",
        ALERT_COOLDOWN_BUDGET_MS: "60000",
        ALERT_COOLDOWN_UNPRICED_MS: "86400000",
      });
      expect(resolved.budget).toBe(60_000);
      expect(resolved["unpriced-model"]).toBe(86_400_000);
      expect(resolved["provider-failure"]).toBe(600_000);
      // 새 종류도 같은 규칙을 따른다 (TASK-3201)
      expect(resolved["pricing-drift"]).toBe(600_000);
      expect(resolved["cost-forecast"]).toBe(600_000);
      expect(resolved["price-source"]).toBe(600_000);
    });

    it("해석할 수 없는 값은 기본값으로 — 경보 폭주보다 안전하다", () => {
      const resolved = resolveCooldowns({
        ALERT_COOLDOWN_MS: "abc",
        ALERT_COOLDOWN_BUDGET_MS: "0",
        ALERT_COOLDOWN_CONFIG_MS: "-1",
      });
      expect(resolved.budget).toBe(DEFAULT_ALERT_COOLDOWN_MS);
      expect(resolved.configuration).toBe(DEFAULT_ALERT_COOLDOWN_MS);
    });

    it("종류별 간격이 실제 억제 판정에 쓰인다", () => {
      const now = 1_000_000;
      const state: AlertState = {
        key: "provider-failure:openai",
        level: "warning",
        status: "ACTIVE",
        notifiedAt: now - 120_000,
      };
      // 전체 기본은 60초(경과) 이지만 provider는 10분(미경과)
      const [decision] = reconcileAlerts([alert()], [state], {
        cooldownMs: 60_000,
        cooldownByKind: { "provider-failure": 600_000 },
        now,
      });
      expect(decision.action).toBe("suppress");
    });
  });
});

/**
 * 공지 실패 장기화 시 등급 승격 (TASK-3401 — CTO 결정 3301-⑥).
 *
 * 하루 넘게 못 읽는데 같은 warning이 반복되면 사람은 그것을 "원래 그런 경보"로
 * 읽는다. 그 순간 경보는 있는데 아무도 보지 않는 상태가 된다.
 */
describe("가격 공지 실패 장기화 (TASK-3401, CTO 결정 3301-⑥)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-07-30T00:00:00Z");

  it("기본 승격 기준은 24시간이다", () => {
    expect(DEFAULT_PRICE_SOURCE_ESCALATE_MS).toBe(DAY);
  });

  it("기준 전에는 warning이다 — 짧은 실패는 흔하고 대개 스스로 낫는다", () => {
    const judged = judgePriceSourceEscalation({
      status: "unreachable",
      failingSince: now - 3 * 60 * 60 * 1000,
      now,
    });
    expect(judged.level).toBe("warning");
    expect(judged.note).toBeNull();
  });

  it("기준을 넘기면 critical로 올린다", () => {
    const judged = judgePriceSourceEscalation({
      status: "unreachable",
      failingSince: now - 2 * DAY,
      now,
    });
    expect(judged.level).toBe("critical");
    expect(judged.note).toContain("48시간째");
  });

  it("미구성은 시간이 지나도 승격하지 않는다 — 미구성과 실패는 다르다", () => {
    const judged = judgePriceSourceEscalation({
      status: "unconfigured",
      failingSince: now - 30 * DAY,
      now,
    });
    expect(judged.level).toBe("warning");
  });

  it("언제부터인지 모르면 승격하지 않는다 — 모르는 것을 오래됐다고 말하지 않는다", () => {
    expect(
      judgePriceSourceEscalation({ status: "unreachable", failingSince: null, now })
        .level,
    ).toBe("warning");
  });

  it("경보에 승격 사유가 함께 실린다", () => {
    const alerts = detectPriceSourceAlerts({
      status: "unreachable",
      needsHumanCheck: true,
      unparsedCount: 0,
      detail: "가격 공지를 가져오지 못했습니다: HTTP 503.",
      sourceId: "openai",
      failingSince: now - 2 * DAY,
      now,
    });
    expect(alerts[0].level).toBe("critical");
    expect(alerts[0].message).toContain("48시간째");
    // 마크다운 강조는 쓰지 않는다 — Slack·메일에서 별표가 그대로 보인다
    expect(alerts[0].message).not.toContain("**");
  });

  it("같은 요청을 두 번 적지 않는다 — 라이브에서 문장이 겹쳐 보였다", () => {
    const alerts = detectPriceSourceAlerts({
      status: "unreachable",
      needsHumanCheck: true,
      unparsedCount: 0,
      // 판정 문구가 이미 "직접 확인"을 말하고 있다
      detail:
        "가격 공지를 가져오지 못했습니다: HTTP 503. 공지를 읽지 못한 것은 " +
        "단가가 그대로라는 뜻이 아닙니다 — 사람이 직접 확인해 주세요 (CTO 정책 3301-①).",
    });
    const occurrences = alerts[0].message.split("직접 확인").length - 1;
    expect(occurrences).toBe(1);
  });

  it("판정 문구가 확인을 말하지 않으면 그 요청을 붙인다", () => {
    const alerts = detectPriceSourceAlerts({
      status: "unconfigured",
      needsHumanCheck: true,
      unparsedCount: 0,
      detail: "가격 공지 주소가 설정되지 않았습니다 — 미구성이며 실패가 아닙니다.",
    });
    expect(alerts[0].message).toContain("사람이 공지를 직접 확인해 주세요");
  });

  it("소스마다 경보 키가 다르다 — 한 곳이 나아도 다른 곳이 뒤에 숨지 않는다", () => {
    const openai = detectPriceSourceAlerts({
      status: "unreachable",
      needsHumanCheck: true,
      unparsedCount: 0,
      detail: "x",
      sourceId: "openai",
    });
    const google = detectPriceSourceAlerts({
      status: "unparsable",
      needsHumanCheck: true,
      unparsedCount: 1,
      detail: "y",
      sourceId: "google",
    });
    expect(openai[0].key).toBe("price-source:openai");
    expect(google[0].key).toBe("price-source:google");
    expect(openai[0].title).toContain("openai");
  });

  it("소스를 안 밝히면 예전 키를 그대로 쓴다 — 기존 경보가 끊기지 않는다", () => {
    const alerts = detectPriceSourceAlerts({
      status: "unreachable",
      needsHumanCheck: true,
      unparsedCount: 0,
      detail: "x",
    });
    expect(alerts[0].key).toBe("price-source:pricing-feed");
  });

  it("승격 기준은 환경변수로 바꿀 수 있고, 잘못 적으면 기본값으로 돈다", () => {
    expect(resolvePriceSourceEscalateMs({ PRICE_SOURCE_ESCALATE_AFTER_MS: "3600000" })).toBe(
      3_600_000,
    );
    expect(resolvePriceSourceEscalateMs({ PRICE_SOURCE_ESCALATE_AFTER_MS: "곧" })).toBe(DAY);
    expect(resolvePriceSourceEscalateMs({})).toBe(DAY);
  });
});

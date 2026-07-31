import { summarizeOperationsKpi } from "./kpi";
import type { Kpi, KpiId, KpiInput } from "./kpi";
import { resolveKpiThresholds } from "./kpi-thresholds";

/**
 * 운영 KPI 검증. (TASK-3801 — CTO 정책 3801-③)
 *
 * 지키는 것: **표본이 없으면 0이 아니라 낼 수 없음**, **좋아 보이는 0을
 * 경계한다**, **모르는 것을 좋음으로 세지 않는다**.
 */
describe("운영 KPI (TASK-3801)", () => {
  const base: KpiInput = {
    windowDays: 30,
    activation: {
      activated: false,
      met: 1,
      total: 3,
      applicable: true,
      heldMs: 3 * 60 * 60 * 1000,
      regressions: 0,
    },
    smoke: { results: [], ranAt: null },
    incidents: { open: 0, resolved: 0, mttrMs: null, mttdMs: null, awaitingPermanentFix: 0 },
    alerts: { active: 0, raised: 0, schedulerRunning: true },
    checks: { total: 0, ok: 0 },
    ci: { total: 0, success: 0 },
    now: Date.parse("2026-07-31T00:00:00Z"),
    thresholds: resolveKpiThresholds({}).thresholds,
  };

  const pick = (input: KpiInput, id: KpiId): Kpi => {
    const found = summarizeOperationsKpi(input).kpis.find((kpi) => kpi.id === id);
    if (found === undefined) {
      throw new Error(`no kpi ${id}`);
    }
    return found;
  };

  describe("표본이 없을 때", () => {
    it("평균 복구 시간은 0분이 아니라 '낼 수 없음'이다", () => {
      const kpi = pick(base, "mttr");
      expect(kpi.value).toBeNull();
      expect(kpi.status).toBe("unknown");
      expect(kpi.caveat).toContain("0분이 아니라");
    });

    it("스모크를 한 번도 안 돌렸으면 '문제 없음'이 아니다", () => {
      const kpi = pick(base, "smoke");
      expect(kpi.value).toBeNull();
      expect(kpi.caveat).toContain("한 번도 부르지 않은 것을");
    });

    it("CI 이력을 못 읽은 것은 '한 번도 안 깨졌다'가 아니다", () => {
      expect(pick(base, "ci").caveat).toContain("한 번도 안 깨졌다");
    });
  });

  describe("좋아 보이는 0", () => {
    it("장애 0건에 '아무도 적지 않았을 수 있다'를 단다", () => {
      const kpi = pick(base, "incidents-open");
      expect(kpi.value).toBe(0);
      expect(kpi.caveat).toContain("아무도 적지 않았다는 뜻일 수도");
    });

    it("기록된 장애가 있으면 그 주의 문구는 사라진다", () => {
      const kpi = pick(
        { ...base, incidents: { ...base.incidents, resolved: 3, mttrMs: 30 * 60000 } },
        "incidents-open",
      );
      expect(kpi.caveat).toBeNull();
    });

    it("감시가 멈춰 있으면 '경보 0건'을 좋음으로 세지 않는다", () => {
      const kpi = pick(
        { ...base, alerts: { active: 0, raised: 0, schedulerRunning: false } },
        "alerts",
      );
      expect(kpi.status).toBe("unknown");
      expect(kpi.caveat).toContain("아무도 보고 있지 않아서일 수 있습니다");
    });
  });

  describe("활성화", () => {
    it("이력이 없으면 '활성화 안 됨'이 아니라 '모른다'다", () => {
      const kpi = pick(
        { ...base, activation: { ...base.activation, activated: null } },
        "activation",
      );
      expect(kpi.status).toBe("unknown");
      expect(kpi.caveat).toContain("'모른다'");
    });

    it("전환 대상이 아닌 환경의 값을 운영 건강도로 읽지 말라고 말한다", () => {
      const kpi = pick(
        { ...base, activation: { ...base.activation, applicable: false } },
        "activation",
      );
      expect(kpi.status).toBe("unknown");
      expect(kpi.basis).toContain("활성화 대상이 아닙니다");
    });

    it("되돌아간 적이 있으면 그 사실을 단다", () => {
      const kpi = pick(
        {
          ...base,
          activation: { ...base.activation, activated: true, met: 3, regressions: 2 },
        },
        "activation",
      );
      expect(kpi.status).toBe("good");
      expect(kpi.caveat).toContain("되돌아간 적 2회");
    });
  });

  describe("스모크", () => {
    it("스텁 응답은 통과로 세지 않고 그 사실을 단다", () => {
      const kpi = pick(
        {
          ...base,
          smoke: {
            results: [{ status: "passed" }, { status: "stubbed" }, { status: "failed" }],
            ranAt: base.now - 1000,
          },
        },
        "smoke",
      );
      expect(kpi.value).toBeCloseTo(33.3, 1);
      expect(kpi.caveat).toContain("스텁 응답이라");
    });

    it("마지막 실행이 오래됐으면 '지금도 되는지는 모른다'고 말한다", () => {
      const kpi = pick(
        {
          ...base,
          smoke: {
            results: [{ status: "passed" }],
            ranAt: base.now - 10 * 24 * 60 * 60 * 1000,
          },
        },
        "smoke",
      );
      expect(kpi.status).toBe("good");
      expect(kpi.caveat).toContain("지금도 되는지는 모릅니다");
    });
  });

  describe("영구 조치 대기", () => {
    it("임시 조치로 닫힌 장애를 따로 센다", () => {
      const kpi = pick(
        { ...base, incidents: { ...base.incidents, awaitingPermanentFix: 3 } },
        "follow-up",
      );
      expect(kpi.value).toBe(3);
      expect(kpi.status).toBe("bad");
      expect(kpi.caveat).toContain("원인은 그대로");
    });
  });

  describe("요약", () => {
    it("모르는 지표가 몇 개인지 먼저 말한다 — 절반을 모르는 초록 화면이 가장 위험하다", () => {
      const report = summarizeOperationsKpi(base);
      expect(report.unknown).toBeGreaterThan(0);
      expect(report.detail).toContain("모르는 것을 좋음으로 세지 않습니다");
    });

    it("전부 정상이면 그렇게 말한다", () => {
      const report = summarizeOperationsKpi({
        ...base,
        activation: { ...base.activation, activated: true, met: 3 },
        smoke: { results: [{ status: "passed" }], ranAt: base.now - 1000 },
        incidents: {
          open: 0,
          resolved: 4,
          mttrMs: 20 * 60000,
          mttdMs: 5 * 60000,
          awaitingPermanentFix: 0,
        },
        checks: { total: 40, ok: 40 },
        ci: { total: 10, success: 10 },
      });
      expect(report.unknown).toBe(0);
      expect(report.bad).toBe(0);
      expect(report.detail).toContain("모든 지표가 정상 범위");
    });

    it("관측 창을 밝힌다", () => {
      expect(summarizeOperationsKpi(base).detail).toContain("최근 30일");
    });
  });
});

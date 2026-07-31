import { compareDiagnostics, detectRegressionAlerts } from "./diagnostic-history";
import type { DiagnosticRunRecord, DiagnosticStatus } from "./diagnostic-history";

const NOW = Date.parse("2026-07-31T07:00:00Z");

function run(
  checks: [string, DiagnosticStatus][],
  overrides: Partial<DiagnosticRunRecord> = {},
): DiagnosticRunRecord {
  return {
    id: "run-1",
    stage: "daily",
    tier: "production",
    ranAt: NOW,
    checks: checks.map(([id, status]) => ({ id, title: `항목 ${id}`, status })),
    ok: checks.filter(([, s]) => s === "ok").length,
    warn: checks.filter(([, s]) => s === "warn").length,
    fail: checks.filter(([, s]) => s === "fail").length,
    unknown: checks.filter(([, s]) => s === "unknown").length,
    ...overrides,
  };
}

describe("compareDiagnostics", () => {
  it("첫 실행은 '변화 없음'이 아니라 기준선이다", () => {
    const comparison = compareDiagnostics(null, run([["db", "ok"]]));
    expect(comparison.comparable).toBe(false);
    expect(comparison.comparedTo).toBeNull();
    expect(comparison.detail).toContain("이번이 기준선입니다");
  });

  it("정상이었다가 나빠진 항목을 먼저 말한다", () => {
    const comparison = compareDiagnostics(
      run([["db", "ok"], ["storage", "fail"]]),
      run([["db", "fail"], ["storage", "fail"]]),
    );
    expect(comparison.regressed.map((row) => row.id)).toEqual(["db"]);
    expect(comparison.persisting.map((row) => row.id)).toEqual(["storage"]);
    expect(comparison.detail.indexOf("새로 나빠진")).toBeLessThan(
      comparison.detail.indexOf("계속 나쁜"),
    );
  });

  it("계속 나쁜 것을 새 사건으로 적지 않는다", () => {
    const comparison = compareDiagnostics(
      run([["db", "fail"]]),
      run([["db", "fail"]]),
    );
    expect(comparison.regressed).toHaveLength(0);
    expect(comparison.detail).toContain("아무도 고치지 않은 것");
  });

  it("정상으로 돌아온 항목을 센다", () => {
    const comparison = compareDiagnostics(
      run([["db", "fail"]]),
      run([["db", "ok"]]),
    );
    expect(comparison.recovered.map((row) => row.id)).toEqual(["db"]);
  });

  /**
   * 이 검사가 이 파일의 존재 이유다 — 순진하게 짜면 사라진 항목이
   * "복구됨"으로 집계되고, 그러면 **없어진 검사가 성과로 보고된다.**
   */
  it("사라진 항목을 복구로 세지 않는다 — 없어진 검사는 실패하지 않는다", () => {
    const comparison = compareDiagnostics(
      run([["db", "ok"], ["activation", "fail"]]),
      run([["db", "ok"]]),
    );
    expect(comparison.recovered).toHaveLength(0);
    expect(comparison.disappeared.map((row) => row.id)).toEqual(["activation"]);
    expect(comparison.detail).toContain("검사 자체가 없어진 것");
    expect(comparison.detail).toContain("없어진 검사는 실패하지 않습니다");
  });

  it("새로 생긴 항목은 따로 센다", () => {
    const comparison = compareDiagnostics(
      run([["db", "ok"]]),
      run([["db", "ok"], ["validation-target", "warn"]]),
    );
    expect(comparison.appeared.map((row) => row.id)).toEqual(["validation-target"]);
    expect(comparison.regressed).toHaveLength(0);
  });

  it("unknown도 좋은 것이 아니다 — 정상에서 unknown이 되면 나빠진 것이다", () => {
    const comparison = compareDiagnostics(
      run([["migrations", "ok"]]),
      run([["migrations", "unknown"]]),
    );
    expect(comparison.regressed.map((row) => row.id)).toEqual(["migrations"]);
  });

  it("달라진 것이 없으면 그렇게 말한다", () => {
    const comparison = compareDiagnostics(run([["db", "ok"]]), run([["db", "ok"]]));
    expect(comparison.detail).toBe("지난 진단과 달라진 항목이 없습니다.");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const comparison = compareDiagnostics(
      run([["db", "ok"], ["gone", "fail"]]),
      run([["db", "fail"], ["new", "warn"]]),
    );
    expect(comparison.detail).not.toContain("**");
  });
});

describe("detectRegressionAlerts", () => {
  const regressed = () =>
    compareDiagnostics(run([["db", "ok"]]), run([["db", "fail"]]));

  it("경보를 내지 않는 단계에서는 아무것도 내지 않는다", () => {
    expect(
      detectRegressionAlerts(regressed(), {
        tier: "development",
        stage: "daily",
        alerting: false,
      }),
    ).toEqual([]);
  });

  it("계속 나쁜 것으로는 경보하지 않는다 — 이미 한 번 알렸다", () => {
    const comparison = compareDiagnostics(run([["db", "fail"]]), run([["db", "fail"]]));
    expect(
      detectRegressionAlerts(comparison, {
        tier: "production",
        stage: "daily",
        alerting: true,
      }),
    ).toEqual([]);
  });

  it("운영의 회귀는 critical이다", () => {
    const alerts = detectRegressionAlerts(regressed(), {
      tier: "production",
      stage: "daily",
      alerting: true,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("critical");
    expect(alerts[0].key).toBe("diagnostics:regression:production:daily");
  });

  it("스테이징의 회귀는 warning이다 — 운영 장애를 덮으면 안 된다", () => {
    const alerts = detectRegressionAlerts(regressed(), {
      tier: "staging",
      stage: "daily",
      alerting: true,
    });
    expect(alerts[0].level).toBe("warning");
    expect(alerts[0].key).toBe("diagnostics:regression:staging:daily");
    expect(alerts[0].title).toContain("[staging]");
  });
});

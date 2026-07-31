import { VALIDATION_STEPS, judgeValidationPlan } from "./validation-plan";
import type { ValidationPlanInput } from "./validation-plan";

const NOW = Date.parse("2026-07-31T00:00:00Z");
const DAY = 86_400_000;

/** 아무것도 준비되지 않은 상태 — 지금 이 환경의 모습이다 */
function blank(overrides: Partial<ValidationPlanInput> = {}): ValidationPlanInput {
  return {
    activation: [
      { id: "credentials", met: false },
      { id: "network", met: false },
      { id: "cutover", met: false },
    ],
    cutover: { verified: 0, total: 3, notProduction: 3 },
    smoke: null,
    diagnostics: { fail: 0, unknown: 0 },
    pendingMigrations: 0,
    urgentChannelConfigured: false,
    stagingTarget: { url: null, usable: false, detail: "검증 대상이 아직 정해지지 않았습니다." },
    kpiSnapshots: 0,
    kpiSnapshotSpanMs: null,
    lastDrillAt: null,
    hosts: { declared: 0, undeclared: 0 },
    now: NOW,
    ...overrides,
  };
}

/** 사람이 줄 것을 다 준 상태 */
function ready(overrides: Partial<ValidationPlanInput> = {}): ValidationPlanInput {
  return blank({
    activation: [
      { id: "credentials", met: true },
      { id: "network", met: true },
      { id: "cutover", met: true },
    ],
    cutover: { verified: 3, total: 3, notProduction: 0 },
    smoke: { passed: 3, total: 3, stubbed: 0 },
    urgentChannelConfigured: true,
    stagingTarget: {
      url: "https://staging.acos.example",
      usable: true,
      detail: "검증 대상: https://staging.acos.example (확인됨).",
    },
    kpiSnapshots: 5,
    lastDrillAt: NOW - 10 * DAY,
    hosts: { declared: 2, undeclared: 0 },
    ...overrides,
  });
}

describe("judgeValidationPlan", () => {
  it("모든 단계에 증거가 있으면 시작할 수 있다", () => {
    const report = judgeValidationPlan(ready());
    expect(report.readiness).toBe("ready");
    expect(report.done).toBe(VALIDATION_STEPS.length);
    expect(report.detail).toContain("검증 스프린트를 시작할 수 있습니다");
  });

  it("사람이 줄 것이 남아 있으면 blocked이며, 우리가 부지런해져도 ready가 되지 않는다", () => {
    const report = judgeValidationPlan(blank());
    expect(report.readiness).toBe("blocked");
    expect(report.waitingOnPeople.map((step) => step.id)).toEqual(
      expect.arrayContaining(["credentials", "egress", "staging", "urgent-channel", "rollback"]),
    );
    expect(report.detail).toContain("코드로 해결되지 않습니다");
  });

  it("우리 쪽 일만 남으면 not-ready다 (blocked과 구분한다)", () => {
    const report = judgeValidationPlan(ready({ kpiSnapshots: 1 }));
    expect(report.readiness).toBe("not-ready");
    expect(report.waitingOnUs.map((step) => step.id)).toEqual(["baseline"]);
    expect(report.waitingOnPeople).toHaveLength(0);
  });

  /**
   * 라이브 검증에서 드러난 결함 1: 검증 대상 환경이 정해지지 않았는데
   * "스키마 적용 완료"가 done으로 찍혔다. 그 증거는 **지금 도는 환경**의
   * 것이고, 검증 대상의 것이 아니다.
   */
  it("검증 대상 환경이 없으면 그 환경을 근거로 하는 단계를 통과로 세지 않는다", () => {
    const report = judgeValidationPlan(
      ready({
        stagingTarget: {
          url: null,
          usable: false,
          detail: "검증 대상이 아직 정해지지 않았습니다.",
        },
      }),
    );
    const migrations = report.steps.find((step) => step.id === "migrations");
    expect(migrations?.status).toBe("blocked");
    expect(migrations?.detail).toContain("검증 대상 환경의 것이 아닙니다");
  });

  /**
   * 라이브 검증에서 드러난 결함 2: 자격 증명이 없어 못 도는 스모크가
   * "우리 쪽에 남은 단계"로 세어졌다. 그러면 우리가 게을러서 안 한 것처럼
   * 보이고, 진짜 병목인 사람 쪽 단계가 그만큼 작아 보인다.
   */
  it("앞 단계에 막힌 것을 우리 몫으로도 사람 몫으로도 세지 않는다", () => {
    const report = judgeValidationPlan(blank());
    expect(report.blocked.map((step) => step.id)).toEqual(
      expect.arrayContaining(["smoke", "cutover", "migrations", "diagnostics"]),
    );
    expect(report.waitingOnUs.map((step) => step.id)).not.toContain("smoke");
    expect(report.waitingOnPeople.map((step) => step.id)).not.toContain("smoke");
    expect(report.detail).toContain("우리가 부지런해져서 풀리지 않습니다");
  });

  it("앞 단계가 막혀 못 하는 것과 아직 안 한 것을 가른다", () => {
    const report = judgeValidationPlan(blank());
    const smoke = report.steps.find((step) => step.id === "smoke");
    expect(smoke?.status).toBe("blocked");
    expect(smoke?.blockedBy).toEqual(
      expect.arrayContaining(["credentials", "egress", "staging"]),
    );
    expect(smoke?.detail).toContain("앞 단계가 끝나지 않아");
  });

  it("스텁 상대의 스모크 통과는 연결 확인이 아니다", () => {
    const report = judgeValidationPlan(
      ready({ smoke: { passed: 3, total: 3, stubbed: 2 } }),
    );
    const smoke = report.steps.find((step) => step.id === "smoke");
    expect(smoke?.status).toBe("pending");
    expect(smoke?.detail).toContain("계약 확인이지 연결 확인이 아닙니다");
  });

  it("운영의 상대가 아닌 대상이 있으면 전환이 끝난 것이 아니다", () => {
    const report = judgeValidationPlan(
      ready({ cutover: { verified: 3, total: 3, notProduction: 1 } }),
    );
    expect(report.steps.find((step) => step.id === "cutover")?.status).toBe("pending");
  });

  it("확인하지 못한 단계는 통과로 세지 않고 ready도 막는다", () => {
    const report = judgeValidationPlan(ready({ pendingMigrations: null }));
    expect(report.unknown.map((step) => step.id)).toEqual(["migrations"]);
    expect(report.readiness).toBe("not-ready");
    expect(report.detail).toContain("통과로 세지 않았습니다");
  });

  it("진단 실패가 0건이어도 모르는 항목이 있으면 done이 아니다", () => {
    const report = judgeValidationPlan(ready({ diagnostics: { fail: 0, unknown: 2 } }));
    const step = report.steps.find((item) => item.id === "diagnostics");
    expect(step?.status).toBe("unknown");
    expect(step?.detail).toContain("정상이 아니라 모르는 것");
  });

  it("한 점짜리 기준선으로는 검증 전후를 비교할 수 없다", () => {
    const report = judgeValidationPlan(ready({ kpiSnapshots: 1 }));
    expect(report.steps.find((step) => step.id === "baseline")?.detail).toContain(
      "한 점으로는",
    );
  });

  it("오래된 리허설은 지금 통한다는 뜻이 아니다", () => {
    const report = judgeValidationPlan(ready({ lastDrillAt: NOW - 200 * DAY }));
    const step = report.steps.find((item) => item.id === "rollback");
    expect(step?.status).toBe("pending");
    expect(step?.detail).toContain("지금 통한다는 뜻은 아닙니다");
  });

  it("활성화 보고를 못 읽으면 자격 증명·길을 모른다고 말한다", () => {
    const report = judgeValidationPlan(ready({ activation: null }));
    expect(report.steps.find((step) => step.id === "credentials")?.status).toBe("unknown");
    expect(report.steps.find((step) => step.id === "egress")?.status).toBe("unknown");
  });

  it("모든 단계에 담당과 증거가 적혀 있다 — 증거를 안 적으면 '아마 됐을 것'이 들어온다", () => {
    for (const step of VALIDATION_STEPS) {
      expect(step.evidence.length).toBeGreaterThan(0);
      expect(["system", "operator"]).toContain(step.owner);
    }
  });

  /**
   * 라이브 검증에서 드러난 결함 3: 주소가 비어 있지 않다는 것만 보고
   * "검증용 환경 확보 완료"로 세었다. 그래서 **운영 주소를 적어 둔
   * 상태에서도** 그 단계가 초록이 되고 뒤 단계까지 줄줄이 열렸다.
   * 같은 값을 두 곳에서 서로 다르게 판정하고 있었다.
   */
  it("주소가 있어도 검증용 환경이 아니면 통과로 세지 않는다", () => {
    const report = judgeValidationPlan(
      ready({
        stagingTarget: {
          url: "https://acos.example",
          usable: false,
          detail: "acos.example는 운영 호스트로 선언돼 있습니다.",
        },
      }),
    );
    const staging = report.steps.find((step) => step.id === "staging");
    expect(staging?.status).toBe("pending");
    expect(staging?.detail).toContain("운영 호스트");
    // 뒤 단계가 열리지 않는다
    expect(report.steps.find((step) => step.id === "migrations")?.status).toBe(
      "blocked",
    );
  });

  it("검증 대상 판정을 못 읽은 것은 '정해졌다'가 아니다", () => {
    const report = judgeValidationPlan(ready({ stagingTarget: null }));
    expect(report.steps.find((step) => step.id === "staging")?.status).toBe("unknown");
    expect(report.readiness).not.toBe("ready");
  });

  /**
   * 검증 대상 보호는 이 목록과 대조해서 동작한다 — 목록이 비어 있으면
   * 보호가 지켜 주는 것이 아니라 통과시키고 있을 뿐이다 (정책 4201-①⑤).
   */
  it("운영 호스트 목록이 비어 있으면 준비가 끝난 것이 아니다", () => {
    const report = judgeValidationPlan(ready({ hosts: { declared: 0, undeclared: 0 } }));
    const step = report.steps.find((row) => row.id === "host-list");
    expect(step?.status).toBe("pending");
    expect(step?.detail).toContain("사실상 꺼져 있습니다");
    expect(report.readiness).not.toBe("ready");
  });

  it("목록에 없는데 쓰이는 호스트가 있으면 통과로 세지 않는다", () => {
    const report = judgeValidationPlan(ready({ hosts: { declared: 2, undeclared: 1 } }));
    expect(report.steps.find((row) => row.id === "host-list")?.status).toBe("pending");
  });

  it("호스트 목록을 못 읽은 것은 '비어 있다'가 아니다", () => {
    const report = judgeValidationPlan(ready({ hosts: null }));
    expect(report.steps.find((row) => row.id === "host-list")?.status).toBe("unknown");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const report = judgeValidationPlan(blank());
    expect(report.detail).not.toContain("**");
    for (const step of report.steps) {
      expect(step.detail).not.toContain("**");
      expect(step.why).not.toContain("**");
    }
  });
});

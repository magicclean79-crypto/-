import { RUNBOOK_STEPS, buildRunbook } from "./activation-runbook";

function states(
  overrides: Record<string, { state: "done" | "pending" | "blocked" | "unknown"; detail: string }> = {},
): Record<string, { state: "done" | "pending" | "blocked" | "unknown"; detail: string }> {
  const base: Record<string, { state: "done" | "pending" | "blocked" | "unknown"; detail: string }> = {};
  for (const step of RUNBOOK_STEPS) {
    base[step.id] = { state: "pending", detail: `${step.title} 대기` };
  }
  return { ...base, ...overrides };
}

describe("RUNBOOK_STEPS", () => {
  /**
   * 되돌리는 법이 안 적힌 단계는, 사고가 났을 때 그 자리에서 지어내게 된다.
   */
  it("모든 단계에 되돌리는 법이 적혀 있다", () => {
    for (const step of RUNBOOK_STEPS) {
      expect(step.rollback.trim().length).toBeGreaterThan(10);
    }
  });

  it("되돌릴 수 없는 단계는 그렇게 적혀 있다", () => {
    for (const step of RUNBOOK_STEPS.filter((row) => row.irreversible)) {
      expect(step.rollback).toContain("되돌릴 수 없");
    }
  });

  /**
   * 되돌릴 수 없는 것을 앞에 두면, 앞에서 발견했을 문제를 뒤에서 발견하게
   * 된다 (정책 4101-⑤와 같은 원칙).
   */
  it("되돌릴 수 없는 단계가 뒤에 있다", () => {
    const first = RUNBOOK_STEPS.findIndex((step) => step.irreversible);
    expect(first).toBeGreaterThan(2);
  });

  it("모든 단계가 어느 판정에서 상태를 가져오는지 밝힌다", () => {
    for (const step of RUNBOOK_STEPS) {
      expect(step.source).toMatch(/^GET \/ops\//);
    }
  });
});

describe("buildRunbook", () => {
  it("완료 수와 다음 단계를 낸다", () => {
    const report = buildRunbook({
      states: states({
        preflight: { state: "done", detail: "사전 점검 통과" },
      }),
    });
    expect(report.done).toBe(1);
    expect(report.total).toBe(RUNBOOK_STEPS.length);
    expect(report.nextStep?.id).toBe("credentials");
  });

  /**
   * 순서를 건너뛰고 "지금 할 수 있는 일"을 고르면, 되돌릴 수 없는 단계가
   * 앞으로 당겨진다.
   */
  it("앞 단계를 건너뛰고 다음 단계를 고르지 않는다", () => {
    const report = buildRunbook({
      states: states({ smoke: { state: "done", detail: "돌았음" } }),
    });
    expect(report.nextStep?.id).toBe("preflight");
  });

  it("되돌릴 수 없는 단계가 다음이면 그렇게 경고한다", () => {
    const done = { state: "done" as const, detail: "완료" };
    const report = buildRunbook({
      states: states({
        preflight: done,
        credentials: done,
        egress: done,
        "host-inventory": done,
      }),
    });
    expect(report.nextStep?.id).toBe("smoke");
    expect(report.detail).toContain("되돌릴 수 없습니다");
  });

  it("상태를 읽지 못한 단계를 통과로 세지 않는다", () => {
    const report = buildRunbook({ states: {} });
    expect(report.done).toBe(0);
    expect(report.detail).toContain("통과로 세지 않았습니다");
    for (const step of report.steps) {
      expect(step.state).toBe("unknown");
      expect(step.detail).toContain("됐다는 뜻이 아닙니다");
    }
  });

  it("사람이 줘야 끝나는 단계를 따로 센다", () => {
    const report = buildRunbook({ states: states() });
    expect(report.waitingOnPeople).toEqual(
      expect.arrayContaining(["실 Provider 자격 증명 주입", "운영 호스트 목록 확정"]),
    );
    expect(report.detail).toContain("코드로 해결되지 않습니다");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const report = buildRunbook({ states: states() });
    expect(report.detail).not.toContain("**");
    for (const step of report.steps) {
      expect(step.why).not.toContain("**");
      expect(step.rollback).not.toContain("**");
      expect(step.detail).not.toContain("**");
    }
  });
});

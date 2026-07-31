import { VALIDATION_RUN_STEPS, judgeRunGate } from "./validation-run";

type GateInput = Parameters<typeof judgeRunGate>[0];

function gate(overrides: Partial<GateInput> = {}): ReturnType<typeof judgeRunGate> {
  return judgeRunGate({
    readiness: "ready",
    waitingOnPeople: [],
    waitingOnUs: [],
    blockedSteps: [],
    target: "accepted",
    tier: "staging",
    ...overrides,
  });
}

describe("VALIDATION_RUN_STEPS", () => {
  it("되돌릴 수 없는 단계가 앞에 오지 않는다", () => {
    const firstIrreversible = VALIDATION_RUN_STEPS.findIndex((step) => !step.reversible);
    // 앞의 단계는 전부 읽기·시험이어야 한다 — 되돌릴 수 없는 것을 먼저 하면
    // 앞에서 발견했을 문제를 뒤에서 발견하게 된다
    expect(firstIrreversible).toBeGreaterThan(2);
    for (const step of VALIDATION_RUN_STEPS.slice(0, firstIrreversible)) {
      expect(step.reversible).toBe(true);
    }
  });

  it("모든 단계에 명령과 실패 시 조치가 적혀 있다", () => {
    for (const step of VALIDATION_RUN_STEPS) {
      expect(step.command.length).toBeGreaterThan(0);
      expect(step.onFailure.length).toBeGreaterThan(0);
      expect(step.onFailure).not.toContain("**");
    }
  });

  it("순번이 1부터 빠짐없이 이어진다", () => {
    expect(VALIDATION_RUN_STEPS.map((step) => step.order)).toEqual(
      VALIDATION_RUN_STEPS.map((_, index) => index + 1),
    );
  });
});

describe("judgeRunGate", () => {
  it("준비가 끝나면 실행 순서를 돌려준다", () => {
    const result = gate();
    expect(result.verdict).toBe("allowed");
    expect(result.blockers).toEqual([]);
    expect(result.steps).toHaveLength(VALIDATION_RUN_STEPS.length);
    expect(result.detail).toContain("돈이 나갑니다");
  });

  it("검증 대상이 없으면 막는다 — 어디에 돌릴지 모르는 채로 시작할 수 없다", () => {
    const result = gate({ target: "unset" });
    expect(result.verdict).toBe("blocked");
    expect(result.blockers.map((row) => row.id)).toContain("target");
  });

  it("대상이 운영을 가리키면 막는다", () => {
    const result = gate({ target: "production" });
    expect(result.verdict).toBe("blocked");
    expect(result.blockers[0].reason).toContain("대상이 성립하지");
  });

  it("운영 인스턴스에서는 실행을 막는다 — 검증은 대상 환경에서 돈다", () => {
    const result = gate({ tier: "production" });
    expect(result.verdict).toBe("blocked");
    expect(result.blockers.map((row) => row.id)).toContain("tier");
  });

  it("사람이 줘야 하는 것이 남아 있으면 그것을 그대로 말한다", () => {
    const result = gate({
      readiness: "blocked",
      waitingOnPeople: ["실 Provider 자격 증명 주입"],
    });
    expect(result.verdict).toBe("blocked");
    expect(result.detail).toContain("코드로 해결되지 않습니다");
  });

  it("우리 쪽 일과 막힌 것을 나눠 말한다", () => {
    const result = gate({
      readiness: "not-ready",
      waitingOnUs: ["KPI 기준선 확보"],
      blockedSteps: ["실 호출 스모크 3종 통과"],
    });
    expect(result.blockers.map((row) => row.id)).toEqual(
      expect.arrayContaining(["us", "blocked"]),
    );
  });

  it("준비 판정이 ready가 아닌데 이유를 못 찾으면 그것도 통과 사유가 아니다", () => {
    const result = gate({ readiness: "not-ready" });
    expect(result.verdict).toBe("blocked");
    expect(result.blockers.map((row) => row.id)).toContain("readiness");
  });

  it("막을 때 이유를 말한다 — 이유 없이 막으면 사람은 우회로를 찾는다", () => {
    const result = gate({ target: "unset" });
    expect(result.detail).toContain("강제로 여는 방법은 없습니다");
    expect(result.detail).toContain("실연결의 증거로 읽힙니다");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    expect(gate().detail).not.toContain("**");
    expect(gate({ target: "local" }).detail).not.toContain("**");
  });
});

import {
  CHECKPOINT_MAX_AGE_MS,
  fingerprintInput,
  planResume,
  type Checkpoint,
} from "./checkpoint";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const STAGES = ["fetch", "ocr", "assemble", "content"] as const;

function checkpoint(stage: string, overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    stage,
    done: overrides.done ?? true,
    output: overrides.output ?? null,
    at: overrides.at ?? NOW - 60_000,
  };
}

describe("planResume (TASK-4603)", () => {
  it("체크포인트가 없으면 처음부터 한다", () => {
    const plan = planResume({
      stages: STAGES,
      checkpoints: [],
      fingerprint: "a",
      savedFingerprint: null,
      now: NOW,
    });
    expect(plan.verdict).toBe("fresh");
    expect(plan.nextStage).toBe("fetch");
  });

  it("끝난 단계까지 건너뛰고 다음부터 이어한다", () => {
    const plan = planResume({
      stages: STAGES,
      checkpoints: [checkpoint("fetch"), checkpoint("ocr")],
      fingerprint: "a",
      savedFingerprint: "a",
      now: NOW,
    });
    expect(plan.verdict).toBe("resume");
    expect(plan.completedStages).toEqual(["fetch", "ocr"]);
    expect(plan.nextStage).toBe("assemble");
  });

  /**
   * 진행 중이던 단계가 어디까지 갔는지 우리는 모른다 — 다시 한다.
   */
  it("진행 중이던 단계는 끝난 것으로 세지 않는다", () => {
    const plan = planResume({
      stages: STAGES,
      checkpoints: [checkpoint("fetch"), checkpoint("ocr", { done: false })],
      fingerprint: "a",
      savedFingerprint: "a",
      now: NOW,
    });
    expect(plan.completedStages).toEqual(["fetch"]);
    expect(plan.nextStage).toBe("ocr");
  });

  /**
   * 5번이 끝났다고 3번을 건너뛰면 3번은 영영 안 한다.
   */
  it("중간이 비어 있으면 거기서 멈춘다", () => {
    const plan = planResume({
      stages: STAGES,
      checkpoints: [checkpoint("fetch"), checkpoint("content")],
      fingerprint: "a",
      savedFingerprint: "a",
      now: NOW,
    });
    expect(plan.completedStages).toEqual(["fetch"]);
    expect(plan.nextStage).toBe("ocr");
    expect(plan.detail).toContain("순서를 건너뛴 체크포인트 1건은 쓰지 않습니다");
  });

  /**
   * 바뀐 입력에 옛 결과를 붙이면 그 결과는 어느 입력의 것도 아니다.
   */
  it("입력이 달라졌으면 이어하지 않는다", () => {
    const plan = planResume({
      stages: STAGES,
      checkpoints: [checkpoint("fetch"), checkpoint("ocr")],
      fingerprint: "b",
      savedFingerprint: "a",
      now: NOW,
    });
    expect(plan.verdict).toBe("input-changed");
    expect(plan.completedStages).toEqual([]);
    expect(plan.nextStage).toBe("fetch");
  });

  it("너무 오래된 체크포인트로는 이어하지 않는다", () => {
    const plan = planResume({
      stages: STAGES,
      checkpoints: [checkpoint("fetch", { at: NOW - CHECKPOINT_MAX_AGE_MS - 1000 })],
      fingerprint: "a",
      savedFingerprint: "a",
      now: NOW,
    });
    expect(plan.verdict).toBe("stale");
    expect(plan.detail).toContain("무엇이 바뀌었는지 우리는 모릅니다");
  });

  it("다 끝나 있으면 다시 할 것이 없다고 말한다", () => {
    const plan = planResume({
      stages: STAGES,
      checkpoints: STAGES.map((stage) => checkpoint(stage)),
      fingerprint: "a",
      savedFingerprint: "a",
      now: NOW,
    });
    expect(plan.verdict).toBe("already-complete");
    expect(plan.nextStage).toBeNull();
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const inputs = [
      { checkpoints: [] as Checkpoint[], saved: null as string | null, fp: "a" },
      { checkpoints: [checkpoint("fetch")], saved: "b", fp: "a" },
      { checkpoints: [checkpoint("fetch")], saved: "a", fp: "a" },
    ];
    for (const input of inputs) {
      const plan = planResume({
        stages: STAGES,
        checkpoints: input.checkpoints,
        fingerprint: input.fp,
        savedFingerprint: input.saved,
        now: NOW,
      });
      expect(plan.detail).not.toContain("**");
    }
  });
});

describe("fingerprintInput (TASK-4603)", () => {
  /**
   * 같은 입력이 순서만 달라져 "바뀐 것"이 되면 이어하기가 영영 안 된다.
   */
  it("키 순서가 달라도 같은 지문이다", () => {
    expect(fingerprintInput({ a: 1, b: 2 })).toBe(fingerprintInput({ b: 2, a: 1 }));
  });

  it("값이 달라지면 지문이 달라진다", () => {
    expect(fingerprintInput({ a: 1 })).not.toBe(fingerprintInput({ a: 2 }));
  });

  it("배열 순서는 의미가 있으므로 지문이 달라진다", () => {
    expect(fingerprintInput([1, 2])).not.toBe(fingerprintInput([2, 1]));
  });

  it("아무 값이나 받아도 터지지 않는다", () => {
    for (const value of [null, undefined, 0, "", [], {}, new Date(0)]) {
      expect(() => fingerprintInput(value)).not.toThrow();
    }
  });
});

import {
  AUTO_RESUME_BATCH,
  AUTO_RESUME_MAX_ROUNDS,
  HEARTBEAT_STALE_MS,
  autoResumeBackoffMs,
  isAutoRetriable,
  planAutoResume,
  selectAutoResumes,
} from "./queue-plan";
import type { QueuedJob } from "./queue-plan";
import { DEFAULT_JOB_RETRY_POLICY } from "./retry-plan";

const NOW = Date.parse("2026-08-01T12:00:00Z");

function job(overrides: Partial<QueuedJob> = {}): QueuedJob {
  return {
    id: "job-1",
    kind: "ocr-batch",
    status: "failed",
    failureKind: "network",
    autoResumeRounds: 0,
    heartbeatAt: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 3_600_000,
    ...overrides,
  };
}

describe("planAutoResume (TASK-4701)", () => {
  it("끝난 작업은 건드리지 않는다", () => {
    expect(planAutoResume(job({ status: "succeeded" }), NOW).verdict).toBe("done");
  });

  /**
   * 돌고 있는 작업을 죽었다고 보고 또 돌리면 **같은 일을 두 번 산다.**
   */
  it("최근에 살아 있었으면 건드리지 않는다", () => {
    const decision = planAutoResume(
      job({ status: "running", heartbeatAt: NOW - 10_000 }),
      NOW,
    );
    expect(decision.verdict).toBe("alive");
  });

  it("심장박동이 멈추면 프로세스가 죽은 것으로 본다", () => {
    const decision = planAutoResume(
      job({ status: "running", heartbeatAt: NOW - HEARTBEAT_STALE_MS - 1 }),
      NOW,
    );
    expect(decision.verdict).toBe("orphaned");
    expect(decision.next).toContain("이어하기");
  });

  /**
   * 라이브에서 잡은 것 (TASK-4701): 이어한 작업의 **시작 시각은 원래
   * 시작한 때**라 이미 오래됐다. 박동을 보지 않고 시작 시각만 보면
   * **지금 돌고 있는 작업을 죽었다고** 판정하고, 인스턴스가 둘이면
   * 같은 일을 두 번 사게 된다.
   */
  it("오래 전에 시작했어도 박동이 최근이면 살아 있다", () => {
    const decision = planAutoResume(
      job({
        status: "running",
        startedAt: NOW - 6 * 3_600_000,
        heartbeatAt: NOW - 5_000,
      }),
      NOW,
    );
    expect(decision.verdict).toBe("alive");
  });

  /** 박동이 한 번도 없으면 시작 시각을 기준으로 본다 */
  it("박동 기록이 없어도 판정한다", () => {
    expect(
      planAutoResume(
        job({ status: "running", heartbeatAt: null, startedAt: NOW - 10_000 }),
        NOW,
      ).verdict,
    ).toBe("alive");
    expect(
      planAutoResume(
        job({ status: "running", heartbeatAt: null, startedAt: NOW - 300_000 }),
        NOW,
      ).verdict,
    ).toBe("orphaned");
  });

  /**
   * 자동 이어하기는 아무도 안 보는 사이에 돈을 쓴다. 그래서 정하는 것은
   * "어떻게 이어할까"가 아니라 "무엇을 이어하지 않을까"다.
   */
  it("정책으로 막힌 실패는 자동으로 이어하지 않는다", () => {
    const decision = planAutoResume(job({ failureKind: "blocked" }), NOW);
    expect(decision.verdict).toBe("hold");
    expect(decision.next).toContain("사람이");
  });

  it("권한·잘못된 요청도 자동에서 뺀다", () => {
    for (const kind of ["unauthorized", "rejected", "invalid-input"]) {
      expect(planAutoResume(job({ failureKind: kind }), NOW).verdict).toBe("hold");
    }
  });

  /**
   * 사람이 누를 때는 "한 번 더 해 보자"가 성립하지만, 자동은 그 판단을 한
   * 사람이 없다.
   */
  it("무엇이 잘못됐는지 모르면 자동으로 돌리지 않는다", () => {
    expect(planAutoResume(job({ failureKind: "unknown" }), NOW).verdict).toBe("hold");
    expect(planAutoResume(job({ failureKind: null }), NOW).verdict).toBe("hold");
  });

  it("다시 해 볼 만한 실패는 이어한다", () => {
    for (const kind of ["network", "timeout", "throttled", "upstream", "database", "storage"]) {
      expect(planAutoResume(job({ failureKind: kind }), NOW).verdict).toBe("resume");
    }
  });

  it("대기가 안 끝났으면 기다린다", () => {
    const decision = planAutoResume(job({ updatedAt: NOW - 1000 }), NOW);
    expect(decision.verdict).toBe("wait");
    expect(decision.waitMs).toBeGreaterThan(0);
  });

  /** 조용히 그만두면 아무도 못 끝낸 작업이 **없는 일**이 된다 */
  it("상한에 닿아도 목록에 남는다", () => {
    const decision = planAutoResume(job({ autoResumeRounds: AUTO_RESUME_MAX_ROUNDS }), NOW);
    expect(decision.verdict).toBe("exhausted");
    expect(decision.next).toContain("사람이");
    expect(decision.reason).toContain("지우지는");
  });

  it("하루가 지나면 이어하지 않는다", () => {
    const decision = planAutoResume(job({ startedAt: NOW - 25 * 3_600_000 }), NOW);
    expect(decision.verdict).toBe("expired");
    expect(decision.next).toContain("새 작업");
  });

  /**
   * 사람이 누른 재시도와 아무도 안 본 재시도는 같은 값이 아니다.
   */
  it("자동 상한이 수동 재시도 상한보다 적다", () => {
    expect(AUTO_RESUME_MAX_ROUNDS).toBeLessThan(DEFAULT_JOB_RETRY_POLICY.maxAttempts);
  });
});

describe("selectAutoResumes (TASK-4701)", () => {
  it("아무것도 없으면 없다고 말한다", () => {
    expect(selectAutoResumes([], NOW).summary).toContain("없습니다");
  });

  /**
   * 장애가 끝난 순간 밀린 작업이 한꺼번에 돌면, 그 청구서도 한꺼번에 온다.
   */
  it("한 번에 정해진 건수까지만 이어한다", () => {
    const jobs = Array.from({ length: AUTO_RESUME_BATCH + 3 }, (_, index) =>
      job({ id: `job-${index}` }),
    );
    const result = selectAutoResumes(jobs, NOW);
    expect(result.resume).toHaveLength(AUTO_RESUME_BATCH);
    expect(result.deferred).toBe(3);
  });

  /** 조용히 자르면 "다 처리했다"로 읽힌다 */
  it("넘긴 건수를 요약에 적는다", () => {
    const jobs = Array.from({ length: AUTO_RESUME_BATCH + 1 }, (_, index) =>
      job({ id: `job-${index}` }),
    );
    const result = selectAutoResumes(jobs, NOW);
    expect(result.summary).toContain("넘긴 작업 1건");
    expect(result.summary).toContain("한꺼번에");
  });

  /**
   * 라이브에서 잡은 것 (TASK-4701): 죽은 프로세스가 남긴 작업을 중단됨으로
   * 표시한 직후 훑기를 눌렀더니 요약이 그 작업을 **한 글자도 말하지
   * 않았습니다.** 대기 중이었을 뿐인데 사람에게는 무시된 것으로 보였고,
   * 그러면 다시 누르거나 손으로 이어하게 됩니다 — 둘 다 돈이 나갑니다.
   */
  it("대기 중인 작업을 요약에서 빠뜨리지 않는다", () => {
    const result = selectAutoResumes([job({ updatedAt: NOW - 1000 })], NOW);
    expect(result.resume).toHaveLength(0);
    expect(result.summary).toContain("대기 중인 작업 1건");
    expect(result.summary).toContain("초 뒤");
  });

  it("사람이 봐야 하는 것과 자동이 포기한 것을 따로 센다", () => {
    const result = selectAutoResumes(
      [
        job({ id: "a", failureKind: "blocked" }),
        job({ id: "b", autoResumeRounds: AUTO_RESUME_MAX_ROUNDS }),
      ],
      NOW,
    );
    expect(result.summary).toContain("사람이 봐야 하는 작업 1건");
    expect(result.summary).toContain("자동이 포기한 작업 1건");
    expect(result.resume).toHaveLength(0);
  });
});

describe("isAutoRetriable", () => {
  it("분류기와 같은 결론을 낸다 (unknown만 제외)", () => {
    expect(isAutoRetriable("network")).toBe(true);
    expect(isAutoRetriable("blocked")).toBe(false);
    expect(isAutoRetriable("unknown")).toBe(false);
    expect(isAutoRetriable(null)).toBe(false);
  });
});

describe("autoResumeBackoffMs", () => {
  it("라운드가 늘수록 더 기다린다", () => {
    expect(autoResumeBackoffMs(1)).toBeGreaterThan(autoResumeBackoffMs(0));
  });

  it("표를 넘어가도 터지지 않는다", () => {
    expect(autoResumeBackoffMs(99)).toBe(autoResumeBackoffMs(1));
    expect(autoResumeBackoffMs(-5)).toBe(autoResumeBackoffMs(0));
  });
});

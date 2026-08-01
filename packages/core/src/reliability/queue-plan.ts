/**
 * 자동 이어하기 판정. (TASK-4701, Sprint 47 — 지시 3 "Queue 기반 자동 Resume")
 *
 * ## 무엇이 문제였는가
 *
 * TASK-4603의 이어하기는 **사람이 눌러야** 동작했습니다. 프로세스가 죽으면
 * 그 순간 돌던 작업은 `running`인 채로 영원히 남고, 아무도 그 행을 보지
 * 않으면 **끝나지 않은 채로 끝난 것처럼** 있습니다. 배포 한 번에 조용히
 * 사라지는 작업이 생긴다는 뜻입니다.
 *
 * ## 그런데 자동은 위험합니다
 *
 * 자동 이어하기는 **아무도 안 보는 사이에 돈을 씁니다.** 사람이 누를 때는
 * 적어도 한 사람이 "지금 이걸 다시 돌린다"는 것을 알고 있습니다. 자동은
 * 그 사람이 없습니다. 그래서 여기서 정하는 것은 "어떻게 이어할까"가 아니라
 * **"무엇을 이어하지 않을까"** 입니다.
 *
 * | 규칙 | 왜 |
 * | --- | --- |
 * | 다시 해서 달라질 실패만 | 예산·권한·잘못된 입력은 열 번 해도 같고, 그중 일부는 **매번 돈이 나간다** |
 * | 라운드 상한 2회 (수동 3회보다 **적게**) | 사람이 누른 재시도와 아무도 안 본 재시도는 같은 값이 아니다 |
 * | 한 번에 5건까지 | 장애가 끝난 순간 밀린 작업이 한꺼번에 돌면, 그 청구서도 한꺼번에 온다 |
 * | 심장박동이 멈춘 것만 죽었다고 본다 | 돌고 있는 작업을 죽었다고 보고 또 돌리면 **같은 일을 두 번 산다** |
 * | 상한에 닿아도 목록에 남는다 | 조용히 그만두면 아무도 못 끝낸 작업이 **없는 일**이 된다 |
 * | 하루가 지나면 이어하지 않는다 | 체크포인트와 같은 창이다 — 그 사이에 무엇이 바뀌었는지 모른다 |
 */

import { classifyFailure } from "./failure-taxonomy";
import { CHECKPOINT_MAX_AGE_MS } from "./checkpoint";

/**
 * 심장박동이 이보다 오래 멈춰 있으면 **그 프로세스는 죽은 것**으로 봅니다.
 *
 * 90초를 고른 이유: 박동 주기(30초)의 세 배입니다. 한 번 놓친 것과 죽은
 * 것을 가르려면 여유가 필요하고, 여유가 없으면 **살아서 돌고 있는 작업을
 * 죽었다고 보고 같은 일을 두 번 삽니다.**
 */
export const HEARTBEAT_STALE_MS = 90_000;

/** 자동 이어하기 라운드 상한 — 수동 재시도(3회)보다 **적습니다** */
export const AUTO_RESUME_MAX_ROUNDS = 2;

/** 라운드별 대기 — 1분 → 10분 */
export const AUTO_RESUME_BACKOFF_MS = [60_000, 600_000] as const;

/**
 * 한 번에 이어할 최대 건수.
 *
 * 상한이 없으면 장애가 끝난 순간 밀린 작업이 **전부 동시에** 돕니다. 그
 * 순간 Provider에게는 우리가 새 장애가 되고, 우리에게는 한 시간치 비용이
 * 1분에 나갑니다.
 */
export const AUTO_RESUME_BATCH = 5;

export type AutoResumeVerdict =
  /** 아직 살아서 돌고 있다 — 건드리지 않는다 */
  | "alive"
  /** 돌고 있다고 적혀 있는데 심장박동이 멈췄다 — 프로세스가 죽었다 */
  | "orphaned"
  /** 지금 이어한다 */
  | "resume"
  /** 이어할 수 있지만 아직 대기 중 */
  | "wait"
  /** 다시 해도 같은 실패다 — **사람이 고쳐야 한다** */
  | "hold"
  /** 자동으로 할 만큼 했다 — **목록에 남는다** */
  | "exhausted"
  /** 너무 오래됐다 */
  | "expired"
  /** 끝난 작업 */
  | "done";

/** 자동 이어하기 판정에 필요한 작업의 모습 */
export interface QueuedJob {
  id: string;
  kind: string;
  status: "running" | "succeeded" | "failed" | "interrupted";
  /** 실패 종류 — 모르면 null */
  failureKind: string | null;
  /** 지금까지 **자동으로** 이어한 횟수 (사람이 누른 것은 세지 않는다) */
  autoResumeRounds: number;
  /** 마지막 심장박동 — 한 번도 없으면 null */
  heartbeatAt: number | null;
  /** 작업이 처음 시작된 시각 */
  startedAt: number;
  /** 마지막으로 상태가 바뀐 시각 — 대기는 여기서부터 잰다 */
  updatedAt: number;
}

export interface AutoResumeDecision {
  jobId: string;
  verdict: AutoResumeVerdict;
  /** 왜 이렇게 판정했는가 — 사람이 읽는다 */
  reason: string;
  /** `wait`일 때 얼마나 더 기다리는가 */
  waitMs: number | null;
  /** 사람이 할 일 — 없으면 null */
  next: string | null;
}

export interface AutoResumePolicy {
  maxRounds?: number;
  staleMs?: number;
  batch?: number;
}

/**
 * 작업 하나를 자동으로 이어할지 정한다 (순수 함수).
 *
 * **모르면 이어하지 않습니다.** 실패 종류를 모르는 작업(`unknown`)은
 * 자동에서 뺍니다 — 무엇이 잘못됐는지 모르는 채로 반복하면 어떤 실패인지
 * 영영 모른 채로 돈만 씁니다(4603과 같은 규칙).
 */
export function planAutoResume(
  job: QueuedJob,
  now: number,
  policy: AutoResumePolicy = {},
): AutoResumeDecision {
  const maxRounds = policy.maxRounds ?? AUTO_RESUME_MAX_ROUNDS;
  const staleMs = policy.staleMs ?? HEARTBEAT_STALE_MS;
  const base = { jobId: job.id, waitMs: null, next: null };

  if (job.status === "succeeded") {
    return { ...base, verdict: "done", reason: "이미 끝난 작업입니다." };
  }

  // 돌고 있다고 적힌 작업 — 살아 있는지부터 봅니다.
  if (job.status === "running") {
    const beat = job.heartbeatAt ?? job.startedAt;
    const silentFor = now - beat;
    if (silentFor <= staleMs) {
      return {
        ...base,
        verdict: "alive",
        reason: `${Math.round(silentFor / 1000)}초 전에 살아 있었습니다 — 돌고 있는 작업은 건드리지 않습니다.`,
      };
    }
    return {
      ...base,
      verdict: "orphaned",
      reason:
        `${Math.round(silentFor / 1000)}초째 심장박동이 없습니다 — 이 작업을 돌리던 ` +
        `프로세스가 죽은 것으로 봅니다.`,
      next: "중단됨으로 표시한 뒤 이어하기 대상에 넣습니다.",
    };
  }

  // 하루가 지난 작업은 이어하지 않습니다 — 체크포인트와 같은 창입니다.
  if (now - job.startedAt > CHECKPOINT_MAX_AGE_MS) {
    return {
      ...base,
      verdict: "expired",
      reason: "시작한 지 24시간이 지났습니다 — 그 사이에 무엇이 바뀌었는지 알 수 없습니다.",
      next: "필요하면 새 작업으로 다시 시작해 주세요. 이어하기로는 하지 않습니다.",
    };
  }

  // 다시 해서 달라질 실패인가. **여기가 이 파일의 핵심입니다.**
  const retriable = isAutoRetriable(job.failureKind);
  if (!retriable) {
    return {
      ...base,
      verdict: "hold",
      reason:
        job.failureKind === null
          ? "실패 종류가 기록되지 않았습니다 — 무엇이 잘못됐는지 모르는 채로 다시 돌리지 않습니다."
          : `"${job.failureKind}"는 다시 해도 같은 결과가 나오는 실패입니다.`,
      next: "원인을 고친 뒤 사람이 이어하기를 눌러 주세요 — 자동으로는 하지 않습니다.",
    };
  }

  if (job.autoResumeRounds >= maxRounds) {
    return {
      ...base,
      verdict: "exhausted",
      reason:
        `자동으로 ${job.autoResumeRounds}번 이어했고 상한(${maxRounds})에 닿았습니다. ` +
        `그만두지만 목록에서 지우지는 않습니다.`,
      next: "사람이 보고 판단해 주세요 — 자동이 포기한 작업은 아무도 모르면 안 됩니다.",
    };
  }

  const waitMs = backoffFor(job.autoResumeRounds);
  const waited = now - job.updatedAt;
  if (waited < waitMs) {
    return {
      ...base,
      verdict: "wait",
      reason: `${Math.round((waitMs - waited) / 1000)}초 뒤에 이어합니다.`,
      waitMs: waitMs - waited,
    };
  }

  return {
    ...base,
    verdict: "resume",
    reason: `"${job.failureKind}"는 다시 해 볼 만한 실패입니다 (자동 ${job.autoResumeRounds + 1}/${maxRounds}회차).`,
  };
}

/**
 * 이어할 작업들을 고른다 — **한 번에 `batch`건까지.**
 *
 * 자른 사실을 결과에 담습니다. 조용히 자르면 "다 처리했다"로 읽히고,
 * 그건 우리가 스프린트마다 경계해 온 모양입니다.
 */
export function selectAutoResumes(
  jobs: QueuedJob[],
  now: number,
  policy: AutoResumePolicy = {},
): {
  decisions: AutoResumeDecision[];
  resume: AutoResumeDecision[];
  deferred: number;
  summary: string;
} {
  const batch = policy.batch ?? AUTO_RESUME_BATCH;
  const decisions = jobs.map((job) => planAutoResume(job, now, policy));
  const eligible = decisions.filter((decision) => decision.verdict === "resume");
  const resume = eligible.slice(0, batch);
  const deferred = eligible.length - resume.length;

  const orphaned = decisions.filter((d) => d.verdict === "orphaned").length;
  const held = decisions.filter((d) => d.verdict === "hold").length;
  const exhausted = decisions.filter((d) => d.verdict === "exhausted").length;
  // 대기 중인 작업을 요약에서 빼면 **아무 일도 안 한 것처럼 보입니다**
  // (라이브에서 잡음). 사람이 훑기를 눌렀는데 "0건"만 보이면 그 작업이
  // 무시된 것인지 기다리는 중인지 알 수 없고, 그러면 다시 누르거나
  // 손으로 이어하게 됩니다 — 둘 다 돈이 나가는 행동입니다.
  const waiting = decisions.filter((d) => d.verdict === "wait");

  const parts: string[] = [];
  if (orphaned > 0) parts.push(`프로세스가 죽어 남은 작업 ${orphaned}건`);
  if (resume.length > 0) parts.push(`이어할 작업 ${resume.length}건`);
  if (deferred > 0) parts.push(`이번 차례에 넘긴 작업 ${deferred}건`);
  if (waiting.length > 0) {
    const soonest = Math.min(...waiting.map((row) => row.waitMs ?? 0));
    parts.push(
      `대기 중인 작업 ${waiting.length}건(가장 이른 것은 ${Math.round(soonest / 1000)}초 뒤)`,
    );
  }
  if (held > 0) parts.push(`사람이 봐야 하는 작업 ${held}건`);
  if (exhausted > 0) parts.push(`자동이 포기한 작업 ${exhausted}건`);

  return {
    decisions,
    resume,
    deferred,
    summary:
      parts.length === 0
        ? "이어할 작업이 없습니다."
        : `${parts.join(" · ")}.` +
          (deferred > 0
            ? ` 한 번에 ${batch}건까지만 이어합니다 — 밀린 작업이 한꺼번에 돌면 그 비용도 한꺼번에 나갑니다.`
            : ""),
  };
}

/**
 * 자동으로 다시 해 볼 만한 실패인가.
 *
 * `classifyFailure`의 `retriable`을 그대로 쓰되 **`unknown`은 제외**합니다 —
 * 사람이 누를 때는 "한 번 더 해 보자"가 성립하지만, 자동은 그 판단을 한
 * 사람이 없습니다.
 */
export function isAutoRetriable(failureKind: string | null): boolean {
  if (failureKind === null || failureKind === "unknown") {
    return false;
  }
  // 종류 이름만으로 판정을 만들지 않고 **같은 분류기에 물어봅니다** —
  // 두 곳에서 다른 결론이 나오면 "왜 이건 이어했고 저건 안 했지"에 답할 수
  // 없습니다.
  return classifyFailure(null, { kind: failureKind as never }).retriable;
}

/** 라운드별 대기 — 표를 넘어가면 마지막 값을 씁니다 */
export function autoResumeBackoffMs(round: number): number {
  return backoffFor(round);
}

function backoffFor(round: number): number {
  if (round < 0) {
    return AUTO_RESUME_BACKOFF_MS[0];
  }
  return AUTO_RESUME_BACKOFF_MS[Math.min(round, AUTO_RESUME_BACKOFF_MS.length - 1)];
}

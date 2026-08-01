import { Injectable } from "@nestjs/common";
import type { Checkpoint } from "@acos/core";

import { ContentsService } from "../contents/contents.service";
import { judgeBatchItem } from "./batch-stage";
import { JobLoggerService } from "./job-logger.service";
import type { JobDefinition, JobStage } from "./job-runner.service";

export interface PublishBatchInput {
  projectId: string;
  contentIds: string[];
  /** 감사 이력에 남을 수행자 */
  actor: string | null;
}

export interface PublishBatchState {
  projectId: string;
  contentIds: string[];
  done: string[];
  /** 거버넌스에 막혔거나 조건을 못 채운 것 — **사유가 남는다** */
  skipped: { contentId: string; reason: string }[];
}

/**
 * 콘텐츠 묶음 발행. (TASK-4701, Sprint 47 — 지시 1)
 *
 * ## 발행은 왜 이 층에 들어오는가
 *
 * 발행 자체는 AI 호출이 아닙니다. 그런데 **거버넌스 판정**을 거치고, 그
 * 판정은 금지어·고지·상품 상태를 봅니다. 스무 건을 발행하다 열두 번째에서
 * 프로세스가 죽으면 지금은 **어디까지 나갔는지 사람이 손으로 확인**해야
 * 합니다. 그리고 발행은 되돌리기가 가장 번거로운 동작입니다.
 *
 * 체크포인트가 여기서 하는 일은 돈을 아끼는 것이 아니라 **"어디까지
 * 나갔는가"에 답하는 것**입니다.
 *
 * ## 막힌 것은 실패가 아니라 결과입니다
 *
 * 거버넌스가 한 건을 막는 것은 **정상 동작**입니다. 그래서 그 건은 건너뛰고
 * 사유를 남기며, 묶음은 계속합니다. 이것을 "우리가 막았으니 멈춘다"로
 * 처리하면 **한 건의 금지어 때문에 나머지 열아홉 건이 안 나갑니다.**
 *
 * 이 구분을 분류기에 맡기지 않고 여기서 못 박는 이유: 분류기는 문구를 보고
 * "우리가 막은 것"을 알아내는데, 거버넌스 사유는 사람이 쓴 글이라 언젠가
 * 그 문구와 겹칩니다. 겹치는 날 묶음이 통째로 멈추고, 그 이유를 아무도
 * 짐작하지 못합니다.
 *
 * ## 기존 발행을 고치지 않습니다
 *
 * `ContentsService.updateStatus`를 **그대로 부릅니다** — 거버넌스 게이트도
 * 감사 이력도 발행 시각 규칙(2701-②)도 전부 그 안에 있습니다. 여기서
 * 다시 판정하지 않습니다.
 */
@Injectable()
export class PublishBatchJob {
  static readonly KIND = "publish-batch";

  constructor(
    private readonly contents: ContentsService,
    private readonly jobLog: JobLoggerService,
  ) {}

  definition(
    input: PublishBatchInput,
  ): JobDefinition<PublishBatchInput, PublishBatchState> {
    const stages: JobStage<PublishBatchState>[] = input.contentIds.map(
      (contentId, index) => ({
        name: `publish:${index + 1}:${contentId}`,
        // 거버넌스 판정은 DB 조회뿐이라 빠릅니다.
        timeoutMs: 60_000,
        run: async (state) => {
          if (state.done.includes(contentId)) {
            return state;
          }

          const verdict = await judgeBatchItem<string>(
            async () => {
              await this.contents.updateStatus(
                input.projectId,
                contentId,
                "PUBLISHED",
                input.actor,
              );
              return { ok: true, value: contentId };
            },
            {
              // 거버넌스·전이 규칙·발행 조건은 **이 한 건의 문제**입니다.
              itemProblem: (error) => isContentProblem(error),
            },
          );

          if (verdict.done) {
            return { ...state, done: [...state.done, contentId] };
          }

          this.jobLog.warn("콘텐츠 한 건을 발행하지 못했습니다.", {
            contentId,
            kind: verdict.kind,
            detail: verdict.detail,
          });
          return {
            ...state,
            skipped: [...state.skipped, { contentId, reason: verdict.reason }],
          };
        },
      }),
    );

    return {
      kind: PublishBatchJob.KIND,
      stages,
      initial: (value) => ({
        projectId: value.projectId,
        contentIds: value.contentIds,
        done: [],
        skipped: [],
      }),
      snapshot: (state) => ({ done: state.done, skipped: state.skipped }),
      restore: (value, checkpoints) => restoreState(value, checkpoints),
    };
  }
}

/**
 * 이 오류가 "콘텐츠 한 건의 문제"인가.
 *
 * 발행이 막히는 정상적인 이유들입니다 — 거버넌스 판정, 전이 규칙, 발행
 * 조건 미충족. 셋 다 **다른 콘텐츠에는 해당되지 않습니다.**
 */
function isContentProblem(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("발행 거버넌스 판정을 통과하지 못했습니다") ||
    message.includes("발행 조건을 충족하지 않습니다") ||
    message.includes("(으)로 전이할 수 없습니다") ||
    message.includes("콘텐츠를 찾을 수 없습니다")
  );
}

function restoreState(
  input: PublishBatchInput,
  checkpoints: Checkpoint[],
): PublishBatchState {
  const newest = checkpoints
    .filter((row) => row.done)
    .reduce<Checkpoint | null>(
      (best, row) => (best === null || row.at > best.at ? row : best),
      null,
    );
  const output = (newest?.output ?? {}) as Partial<PublishBatchState>;
  return {
    projectId: input.projectId,
    contentIds: input.contentIds,
    done: Array.isArray(output.done) ? output.done : [],
    skipped: Array.isArray(output.skipped) ? output.skipped : [],
  };
}

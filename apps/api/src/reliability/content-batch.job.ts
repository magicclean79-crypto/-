import { Injectable } from "@nestjs/common";
import type { Checkpoint } from "@acos/core";

import { ContentGenerationService } from "../contents/content-generation.service";
import { judgeBatchItem } from "./batch-stage";
import { JobLoggerService } from "./job-logger.service";
import type { JobDefinition, JobStage } from "./job-runner.service";

export interface ContentBatchInput {
  projectId: string;
  /** 생성할 Product Object 버전들 — 버전 하나가 한 단계 */
  versions: number[];
}

export interface ContentBatchState {
  projectId: string;
  versions: number[];
  done: { version: number; contentId: string }[];
  skipped: { version: number; reason: string }[];
}

/**
 * 상세페이지 묶음 생성. (TASK-4701, Sprint 47 — 지시 1)
 *
 * ## 이 작업이 가장 비쌉니다
 *
 * 생성은 프롬프트가 길고(Company Brain + OCR 본문 + Vision 라벨) 출력도
 * 깁니다. 열 건을 돌리다 여덟 번째에서 죽으면 **앞의 일곱 건 값을 다시
 * 냅니다.** 그리고 그 값은 이 저장소에서 가장 큽니다.
 *
 * ## 기존 생성을 고치지 않습니다
 *
 * `ContentGenerationService.generate`를 **그대로 부릅니다.** 공식 생성
 * 경로(`POST …/contents/generate`)는 예전과 똑같이 동작합니다.
 *
 * ## 왜 버전 하나가 한 단계인가
 *
 * 한 단계에 여러 버전을 넣으면 체크포인트가 그 묶음 단위가 되고, 묶음의
 * 마지막에서 죽으면 **앞의 것까지 다시 삽니다.** 단계가 잘게 나뉠수록
 * 이어하기가 아끼는 돈이 큽니다.
 */
@Injectable()
export class ContentBatchJob {
  static readonly KIND = "content-batch";

  constructor(
    private readonly generation: ContentGenerationService,
    private readonly jobLog: JobLoggerService,
  ) {}

  definition(
    input: ContentBatchInput,
  ): JobDefinition<ContentBatchInput, ContentBatchState> {
    const stages: JobStage<ContentBatchState>[] = input.versions.map(
      (version, index) => ({
        name: `content:${index + 1}:v${version}`,
        // 생성은 출력이 길어 가장 오래 걸립니다.
        timeoutMs: 180_000,
        run: async (state) => {
          if (state.done.some((row) => row.version === version)) {
            return state;
          }

          // 생성은 실패를 **던집니다** (분석·OCR과 달리 FAILED 상태를
          // 돌려주지 않습니다). 그래서 `ok: true`만 돌려주고, 실패는
          // `judgeBatchItem`의 catch가 받습니다.
          const verdict = await judgeBatchItem<string>(async () => {
            const content = await this.generation.generate(input.projectId, {
              productObjectVersion: version,
            });
            return { ok: true, value: content.id };
          });

          if (verdict.done) {
            return {
              ...state,
              done: [...state.done, { version, contentId: verdict.value }],
            };
          }

          this.jobLog.warn("버전 하나를 건너뜁니다.", {
            version,
            kind: verdict.kind,
            detail: verdict.detail,
          });
          return {
            ...state,
            skipped: [...state.skipped, { version, reason: verdict.reason }],
          };
        },
      }),
    );

    return {
      kind: ContentBatchJob.KIND,
      stages,
      initial: (value) => ({
        projectId: value.projectId,
        versions: value.versions,
        done: [],
        skipped: [],
      }),
      // **본문을 담지 않습니다.** 생성된 Markdown은 contents 테이블에 있고,
      // 체크포인트에 넣으면 매 단계 쓰기가 본문 길이만큼 느려집니다.
      snapshot: (state) => ({ done: state.done, skipped: state.skipped }),
      restore: (value, checkpoints) => restoreState(value, checkpoints),
    };
  }
}

function restoreState(
  input: ContentBatchInput,
  checkpoints: Checkpoint[],
): ContentBatchState {
  const newest = checkpoints
    .filter((row) => row.done)
    .reduce<Checkpoint | null>(
      (best, row) => (best === null || row.at > best.at ? row : best),
      null,
    );
  const output = (newest?.output ?? {}) as Partial<ContentBatchState>;
  return {
    projectId: input.projectId,
    versions: input.versions,
    done: Array.isArray(output.done) ? output.done : [],
    skipped: Array.isArray(output.skipped) ? output.skipped : [],
  };
}

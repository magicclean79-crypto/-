import { Injectable } from "@nestjs/common";
import { classifyFailure } from "@acos/core";
import type { Checkpoint } from "@acos/core";

import { OcrService } from "../ocr/ocr.service";
import { JobLoggerService } from "./job-logger.service";
import type { JobDefinition, JobStage } from "./job-runner.service";

export interface OcrBatchInput {
  imageIds: string[];
}

export interface OcrBatchState {
  imageIds: string[];
  /** 끝난 이미지 — 이어할 때 다시 사지 않는다 */
  done: { imageId: string; ocrId: string }[];
  /** 실패했지만 배치를 멈추지는 않은 것 */
  skipped: { imageId: string; reason: string }[];
}

/**
 * 이미지 묶음 OCR — 이 저장소 첫 번째 "이어할 수 있는 작업".
 * (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * ## 왜 이것을 첫 대상으로 골랐는가
 *
 * OCR은 **돈이 나가고, 여러 건이고, 오래 걸립니다.** 열 장을 돌리다 일곱
 * 번째에서 죽으면 지금은 처음부터 다시 해야 하고, 앞의 여섯 장은 이미
 * 값을 치렀는데도 다시 삽니다. 체크포인트가 가장 크게 값을 하는 자리입니다.
 *
 * ## 기존 OCR을 고치지 않습니다
 *
 * `OcrService.runOcr`을 **그대로 부릅니다.** 기존 `POST /images/:id/ocr`은
 * 예전과 똑같이 동작합니다 — 이 작업은 그 위에 얹히는 배치일 뿐입니다.
 *
 * ## 한 장이 실패하면 배치를 멈추는가
 *
 * **경우에 따라 다릅니다**, 그리고 그 판단을 여기서 하지 않습니다:
 *
 * - 그 이미지 하나의 문제(파일이 깨졌다·없다)라면 **건너뛰고 계속**합니다.
 *   한 장 때문에 나머지 아홉 장을 못 하면 배치의 의미가 없습니다.
 * - 공통 원인(예산 초과·Provider 다운)이라면 **멈춥니다.** 계속해 봐야 열
 *   번 더 실패하고, 그중 일부는 돈이 나갑니다.
 *
 * 가르는 기준은 `classifyFailure`입니다 — 재시도할 만한 실패(연결·시간
 * 초과·상대 서버)나 정책으로 막힌 것은 **공통 원인**으로 보고 멈춥니다.
 * 건너뛴 것은 결과에 남으므로 **조용히 사라지지 않습니다.**
 */
@Injectable()
export class OcrBatchJob {
  static readonly KIND = "ocr-batch";

  constructor(
    private readonly ocr: OcrService,
    private readonly jobLog: JobLoggerService,
  ) {}

  /**
   * 단계는 이미지 1장 = 1단계입니다.
   *
   * 한 단계에 열 장을 넣으면 체크포인트가 열 장 단위가 되고, 그러면
   * 아홉 번째에서 죽었을 때 **여덟 장을 다시 삽니다.**
   */
  definition(input: OcrBatchInput): JobDefinition<OcrBatchInput, OcrBatchState> {
    const stages: JobStage<OcrBatchState>[] = input.imageIds.map((imageId, index) => ({
      name: `ocr:${index + 1}:${imageId}`,
      // OCR Provider의 자체 타임아웃(20초)보다 넉넉하게 — 여기서 먼저
      // 끊으면 Provider가 남긴 실패 이유를 못 봅니다.
      timeoutMs: 60_000,
      run: async (state) => {
        if (state.done.some((row) => row.imageId === imageId)) {
          return state;
        }
        try {
          const result = await this.ocr.runOcr(imageId);
          // **던지지 않았다고 성공이 아닙니다** (라이브에서 잡음).
          // `runOcr`은 Provider 실패를 기록하고 `status: "FAILED"`로
          // 돌려줍니다 — 한 장이 실패했다고 요청 전체를 500으로 만들지
          // 않으려는 의도이고, 그 판단은 옳습니다. 그런데 그것을 그대로
          // 성공으로 세면 **"3/3 끝냈습니다"라고 말하면서 한 장은 글자가
          // 없는** 상태가 되고, 체크포인트가 그 장을 끝난 것으로 표시해
          // 이어하기로도 다시 시도되지 않습니다.
          if (result.status !== "SUCCESS") {
            // **기록된 실패 사유를 분류합니다.** 던지지 않았다고 해서 이
            // 실패가 "이 한 장의 문제"라는 뜻은 아닙니다 — Provider가
            // 통째로 죽어 있으면 모든 장이 같은 이유로 실패하고, 그때
            // 계속 진행하면 열 번 더 실패하며 그중 일부는 돈이 나갑니다.
            const recorded = classifyFailure(new Error(result.error ?? ""));
            if (recorded.retriable || recorded.kind === "blocked") {
              throw new Error(result.error ?? "OCR이 실패로 끝났습니다");
            }
            this.jobLog.warn("OCR이 실패로 끝난 이미지를 건너뜁니다.", {
              imageId,
              status: result.status,
              detail: result.error ?? "원문 없음",
            });
            return {
              ...state,
              skipped: [
                ...state.skipped,
                {
                  imageId,
                  reason: "이 이미지에서 글자를 읽지 못했습니다. 파일을 확인해 주세요.",
                },
              ],
            };
          }
          return {
            ...state,
            done: [...state.done, { imageId, ocrId: result.id }],
          };
        } catch (error) {
          const verdict = classifyFailure(error);
          // 공통 원인이면 멈춥니다 — 계속해 봐야 열 번 더 실패합니다.
          if (verdict.retriable || verdict.kind === "blocked") {
            throw error;
          }
          // 이 한 장의 문제입니다 — 건너뛰되 결과에 남깁니다.
          this.jobLog.warn("이미지 한 장을 건너뜁니다.", {
            imageId,
            kind: verdict.kind,
            detail: verdict.operatorDetail,
          });
          return {
            ...state,
            skipped: [...state.skipped, { imageId, reason: verdict.userMessage }],
          };
        }
      },
    }));

    return {
      kind: OcrBatchJob.KIND,
      stages,
      initial: (value) => ({ imageIds: value.imageIds, done: [], skipped: [] }),
      // 체크포인트에는 **id만** 담습니다. 추출한 본문을 담으면 체크포인트가
      // 커져서 매 단계 쓰기가 느려지고, 그 본문은 이미 ocr_results에
      // 있습니다.
      snapshot: (state) => ({ done: state.done, skipped: state.skipped }),
      restore: (value, checkpoints) => restoreState(value, checkpoints),
    };
  }
}

function restoreState(input: OcrBatchInput, checkpoints: Checkpoint[]): OcrBatchState {
  const newest = checkpoints
    .filter((row) => row.done)
    .reduce<Checkpoint | null>((best, row) => (best === null || row.at > best.at ? row : best), null);
  const output = (newest?.output ?? {}) as Partial<OcrBatchState>;
  return {
    imageIds: input.imageIds,
    done: Array.isArray(output.done) ? output.done : [],
    skipped: Array.isArray(output.skipped) ? output.skipped : [],
  };
}

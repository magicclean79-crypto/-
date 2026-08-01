import { classifyFailure } from "@acos/core";

/**
 * 묶음 작업의 한 건을 판정한다. (TASK-4701, Sprint 47 — 지시 1)
 *
 * ## 왜 한자리에 모으는가
 *
 * TASK-4603에서 라이브 결함 4건 중 **2건이 바로 이 규칙**이었습니다:
 *
 * - 던지지 않고 `FAILED`로 돌아온 결과를 성공으로 셌다.
 * - Provider가 통째로 죽은 것을 "이 한 건의 문제"로 보고 전부 건너뛴 뒤
 *   작업을 성공으로 끝냈다.
 *
 * 이번에 같은 모양의 작업이 셋 더 생깁니다(분석·생성·발행). 규칙을 네 군데에
 * 복사하면 **넷 중 하나는 반드시 다르게 씁니다** — 그리고 다른 그 하나는
 * 사고가 난 날에만 드러납니다.
 *
 * ## 규칙
 *
 * | 원인 | 처리 | 왜 |
 * | --- | --- | --- |
 * | 공통 원인 (연결·시간 초과·상대 서버·DB·정책) | **멈춘다** (던진다) | 계속해 봐야 열 번 더 실패하고 그중 일부는 돈이 나간다 |
 * | 이 한 건의 문제 (파일 없음·형식·입력) | **건너뛰되 결과에 남긴다** | 한 건 때문에 나머지 아홉 건을 못 하면 묶음의 의미가 없다 |
 *
 * `unknown`은 **건너뜁니다**. 멈추는 쪽이 안전해 보이지만, 모르는 실패
 * 하나로 묶음 전체를 멈추면 그 한 건 때문에 나머지가 영영 안 돌고, 그
 * 이유를 아무도 모릅니다. 대신 건너뛴 사실이 결과에 남아 사람이 봅니다.
 */

/** 한 건을 돌린 결과 — 던지지 않고 실패를 돌려주는 서비스를 위해 */
export type ItemOutcome<TValue> =
  | { ok: true; value: TValue }
  /** 이 한 건이 실패했다 — 사유 원문(운영자용) */
  | { ok: false; error: string };

/** 판정 결과 */
export type ItemVerdict<TValue> =
  | { done: true; value: TValue }
  /** 건너뛴다 — `reason`은 **사용자에게 보여 줄 문장**이다 */
  | { done: false; reason: string; kind: string; detail: string };

/**
 * 한 건을 돌리고 "건너뛸 문제"와 "멈춰야 할 문제"를 가른다.
 *
 * **멈춰야 하면 던집니다** — 실행기가 그 오류를 분류해 작업을 실패로
 * 끝내고, 끝난 단계는 체크포인트에 남아 이어할 수 있습니다.
 */
export async function judgeBatchItem<TValue>(
  run: () => Promise<ItemOutcome<TValue>>,
  options: {
    /**
     * "이건 무조건 이 한 건의 문제다"를 부르는 쪽이 아는 경우.
     *
     * 필요한 이유: 분류기는 문구를 보고 **우리가 막은 것**을 알아냅니다
     * (`예산을 초과` 등). 그런데 거버넌스가 콘텐츠 하나를 막은 것도 우리가
     * 막은 것이고, 문구가 우연히 겹치면 **한 건이 막혔다고 묶음 전체가
     * 멈춥니다.** 그건 틀립니다 — 다른 아홉 건은 통과할 수 있습니다.
     *
     * 그래서 부르는 쪽이 아는 경우에만 이 예외를 씁니다. 기본값은 없습니다.
     */
    itemProblem?: (error: unknown) => boolean;
  } = {},
): Promise<ItemVerdict<TValue>> {
  let outcome: ItemOutcome<TValue>;
  try {
    outcome = await run();
  } catch (error) {
    const verdict = classifyFailure(error);
    // 공통 원인이면 멈춥니다.
    if (stopsBatch(verdict.kind, verdict.retriable) && options.itemProblem?.(error) !== true) {
      throw error;
    }
    return {
      done: false,
      reason: verdict.userMessage,
      kind: verdict.kind,
      detail: verdict.operatorDetail,
    };
  }

  if (outcome.ok) {
    return { done: true, value: outcome.value };
  }

  // **던지지 않았다고 성공이 아닙니다.** 기록된 사유를 그대로 분류합니다 —
  // 던지지 않았다는 것이 "이 한 건의 문제"라는 뜻은 아닙니다.
  const failure = new Error(outcome.error);
  const verdict = classifyFailure(failure);
  if (stopsBatch(verdict.kind, verdict.retriable) && options.itemProblem?.(failure) !== true) {
    throw failure;
  }
  return {
    done: false,
    reason: verdict.userMessage,
    kind: verdict.kind,
    detail: verdict.operatorDetail,
  };
}

/**
 * 묶음을 멈춰야 하는 실패인가.
 *
 * `blocked`를 포함하는 이유: 예산으로 막힌 상태에서 나머지를 계속 돌리면
 * **막힌 이유를 모른 채 실패만 쌓입니다.** 그리고 그 막힘이 풀린 뒤에
 * 이어하면 되므로, 멈추는 것이 잃는 것이 없습니다.
 *
 * `unauthorized`를 포함하는 이유 (TASK-4701): **키가 틀린 것은 한 건의
 * 문제가 될 수 없습니다.** 자격 증명은 항목마다 다르지 않으므로, 한 건이
 * 401을 받았다면 나머지도 전부 받습니다. 그런데 재시도 대상이 아니라는
 * 이유로 "이 한 건의 문제"로 처리하면 **전부 건너뛰고 작업은 성공으로
 * 끝납니다** — 키가 만료된 날 화면이 초록입니다.
 */
export function stopsBatch(kind: string, retriable: boolean): boolean {
  return retriable || kind === "blocked" || kind === "unauthorized";
}

/**
 * 결과 문장을 만든다.
 *
 * **전부 건너뛰었으면 그 사실을 말합니다** — 아무것도 못 얻은 실행이
 * 성공으로 읽히면 안 됩니다(4603 라이브에서 고친 것).
 */
export function describeBatch(input: {
  total: number;
  done: number;
  skipped: { reason: string }[];
  /** 건너뛴 항목의 이름들 — 사람이 무엇을 다시 볼지 알아야 한다 */
  skippedIds: string[];
  unit: string;
}): string {
  const parts = [`${input.done}/${input.total}${input.unit}을 끝냈습니다.`];
  if (input.skipped.length > 0) {
    parts.push(
      `결과를 얻지 못해 건너뛴 항목 ${input.skipped.length}건이 있습니다: ` +
        `${input.skippedIds.slice(0, 10).join(", ")}` +
        (input.skippedIds.length > 10 ? ` 외 ${input.skippedIds.length - 10}건` : "") +
        ".",
    );
  }
  if (input.done === 0 && input.total > 0) {
    parts.push("결과를 얻은 항목이 하나도 없습니다.");
  }
  return parts.join(" ");
}

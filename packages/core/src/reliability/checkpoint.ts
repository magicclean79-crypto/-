/**
 * 체크포인트와 이어하기. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * 여러 이미지를 OCR 하는 작업이 7번째에서 죽으면, 지금은 **처음부터**
 * 다시 해야 합니다. 앞의 6건은 이미 성공했고 이미 돈을 냈는데도요.
 *
 * 체크포인트는 그 6건을 **다시 사지 않게** 합니다.
 *
 * ## 이어하기가 위험한 이유
 *
 * "이어한다"는 말은 **하지 않은 일을 했다고 치는 것**과 종이 한 장
 * 차이입니다. 그래서 세 가지를 지킵니다:
 *
 * 1. **끝난 단계만 건너뜁니다.** 진행 중이던 단계는 다시 합니다 — 그
 *    단계가 어디까지 갔는지 우리는 모릅니다.
 * 2. **오래된 체크포인트로는 이어하지 않습니다.** 그 사이에 입력이 바뀌었을
 *    수 있고, 바뀐 입력에 옛 결과를 붙이면 그 결과는 **어느 입력의 것도
 *    아닙니다.**
 * 3. **입력이 달라졌으면 이어하지 않습니다.** 무엇으로 시작했는지를
 *    지문으로 남기고, 다르면 처음부터 합니다.
 */

/** 한 단계의 결과 */
export interface Checkpoint {
  /** 단계 이름 */
  stage: string;
  /** 이 단계가 끝났는가 — **진행 중은 끝난 것이 아닙니다** */
  done: boolean;
  /** 다음 단계가 쓸 값 (작아야 합니다 — 여기에 본문을 넣지 않습니다) */
  output: unknown;
  /** 언제 (epoch ms) */
  at: number;
}

/** 이어할 수 있는 시간 상한 — 이보다 오래된 체크포인트는 쓰지 않습니다 */
export const CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ResumeVerdict =
  /** 이어한다 */
  | "resume"
  /** 처음부터 한다 — 체크포인트가 없다 */
  | "fresh"
  /** 처음부터 한다 — 너무 오래됐다 */
  | "stale"
  /** 처음부터 한다 — 입력이 달라졌다 */
  | "input-changed"
  /** 이미 다 끝났다 */
  | "already-complete";

export interface ResumePlan {
  verdict: ResumeVerdict;
  /** 건너뛸 단계 (끝난 것만) */
  completedStages: string[];
  /** 여기서부터 다시 한다 — 없으면 null */
  nextStage: string | null;
  detail: string;
}

/**
 * 이어할 수 있는가 (순수 함수).
 *
 * @param stages 이 작업이 밟아야 하는 전체 순서
 * @param checkpoints 지금까지 남은 체크포인트
 * @param fingerprint 지금 입력의 지문
 * @param savedFingerprint 체크포인트를 남길 때의 입력 지문
 */
export function planResume(input: {
  stages: readonly string[];
  checkpoints: readonly Checkpoint[];
  fingerprint: string;
  savedFingerprint: string | null;
  now: number;
  maxAgeMs?: number;
}): ResumePlan {
  const maxAgeMs = input.maxAgeMs ?? CHECKPOINT_MAX_AGE_MS;
  // **끝난 것만** 셉니다. 진행 중이던 단계는 어디까지 갔는지 모릅니다.
  const done = input.checkpoints.filter((row) => row.done);

  if (done.length === 0) {
    return {
      verdict: "fresh",
      completedStages: [],
      nextStage: input.stages[0] ?? null,
      detail: "이어할 체크포인트가 없습니다 — 처음부터 합니다.",
    };
  }

  if (input.savedFingerprint !== null && input.savedFingerprint !== input.fingerprint) {
    return {
      verdict: "input-changed",
      completedStages: [],
      nextStage: input.stages[0] ?? null,
      detail:
        "시작할 때의 입력과 지금 입력이 다릅니다 — 처음부터 합니다. " +
        "바뀐 입력에 옛 결과를 붙이면 그 결과는 어느 입력의 것도 아닙니다.",
    };
  }

  const newest = done.reduce((best, row) => (row.at > best.at ? row : best), done[0]);
  const age = input.now - newest.at;
  if (age > maxAgeMs) {
    return {
      verdict: "stale",
      completedStages: [],
      nextStage: input.stages[0] ?? null,
      detail:
        `마지막 체크포인트가 ${Math.floor(age / 3_600_000)}시간 전입니다 — ` +
        "처음부터 합니다. 그 사이에 무엇이 바뀌었는지 우리는 모릅니다.",
    };
  }

  // **순서대로 끝난 것까지만** 건너뜁니다. 중간이 비어 있으면 거기서
  // 멈춥니다 — 5번이 끝났다고 3번을 건너뛰면 3번은 영영 안 합니다.
  const completed: string[] = [];
  for (const stage of input.stages) {
    if (done.some((row) => row.stage === stage)) {
      completed.push(stage);
    } else {
      break;
    }
  }

  const nextStage = input.stages[completed.length] ?? null;
  if (nextStage === null) {
    return {
      verdict: "already-complete",
      completedStages: completed,
      nextStage: null,
      detail: "모든 단계가 끝나 있습니다 — 다시 할 것이 없습니다.",
    };
  }

  const skippedOutOfOrder = done.length - completed.length;
  return {
    verdict: "resume",
    completedStages: completed,
    nextStage,
    detail:
      `${completed.length}단계까지 끝나 있어 "${nextStage}"부터 이어합니다.` +
      (skippedOutOfOrder > 0
        ? ` 순서를 건너뛴 체크포인트 ${skippedOutOfOrder}건은 쓰지 않습니다 — 중간이 비어 있으면 그 단계는 영영 안 하게 됩니다.`
        : ""),
  };
}

/**
 * 입력 지문 (순수 함수).
 *
 * 암호용이 아니라 **달라졌는지만** 보는 값입니다. 그래서 짧고 빠른 것으로
 * 충분하고, 대신 **키 순서에 흔들리지 않아야** 합니다 — 같은 입력이 순서만
 * 달라져 "바뀐 것"이 되면 이어하기가 영영 안 됩니다.
 */
export function fingerprintInput(value: unknown): string {
  const text = stableStringify(value);
  // djb2 — 충돌 확률보다 **재현성**이 중요합니다
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(16)}-${text.length}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

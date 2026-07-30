/**
 * Provider 연결 순서와 단계별 상태. (TASK-2901, Sprint 29 — CTO 결정 2801-⑤)
 *
 * CTO가 실제 Provider 연결 순서를 확정했습니다:
 * **OpenAI → Anthropic → Gemini → Vision → OCR.**
 *
 * 이 순서를 주석이 아니라 **값**으로 둡니다. 순서가 코드 어디에도 없으면
 * "지금 어디까지 붙었고 다음에 무엇을 붙여야 하는가"에 아무도 답할 수 없고,
 * 그러면 각자 편한 것부터 붙입니다.
 *
 * 판정에서 가장 중요한 구분은 셋입니다:
 *
 * | 상태 | 뜻 |
 * | --- | --- |
 * | `not-configured` | **아직 붙이지 않았다** — 실패가 아닙니다 |
 * | `unverified` | 설정은 됐지만 **실제로 붙는지는 모릅니다** — 형식 검사는 유효성 보장이 아닙니다 |
 * | `connected` | 그 Provider로 **성공한 실행 기록이 있습니다** |
 *
 * **`unverified`를 `connected`로 세지 않습니다.** 키 형식이 맞다는 것은
 * 오타가 없다는 뜻일 뿐이고, 그것을 연결 완료로 세면 **연결되지 않은 시스템이
 * 연결된 것처럼 보고**됩니다 — 모르는 것을 통과로 처리하지 않는다는 원칙
 * (결정 1301-① 계열)이 여기서도 그대로 적용됩니다.
 *
 * 연결됨의 근거는 **선언이 아니라 사실**입니다: 그 Provider로 성공한 실행
 * 기록(LLM Execution · OCR 실행 이력)이 있어야 `connected`입니다.
 *
 * 그 근거에는 **기한**이 있습니다(`ROLLOUT_EVIDENCE_WINDOW_DAYS`). 2년 전에
 * 한 번 성공했다는 기록으로 "지금도 붙어 있다"고 말할 수는 없습니다 — 키는
 * 회수되고 할당량은 끊깁니다. 창을 두면 판정이 **스스로 낡습니다**: 호출이
 * 멈추면 얼마 뒤 `unverified`로 돌아가고, 그것이 정직한 답입니다.
 */

import { validateApiKeyFormat } from "../llm/api-key";

/** CTO가 확정한 연결 순서 (결정 2801-⑤) — 값으로 고정한다 */
export const PROVIDER_ROLLOUT_ORDER = [
  "openai",
  "anthropic",
  "gemini",
  "vision",
  "ocr",
] as const;

export type ProviderRolloutStage = (typeof PROVIDER_ROLLOUT_ORDER)[number];

export type RolloutStatus =
  /** 그 Provider로 성공한 실행 기록이 있다 */
  | "connected"
  /** 설정은 됐지만 성공 기록이 없다 — **모르는 것** */
  | "unverified"
  /** 키 형식이 틀렸거나 플레이스홀더다 */
  | "invalid"
  /** 아직 붙이지 않았다 — 실패가 아니다 */
  | "not-configured"
  /** 가짜(mock)가 돌고 있다 — 결과는 나오지만 진짜가 아니다 */
  | "mock"
  /** 개발용 선택 엔진이다 — 운영 연결로 세지 않는다 (결정 2401-⑤) */
  | "dev-only";

export interface RolloutStageView {
  stage: ProviderRolloutStage;
  /** 1부터 시작하는 순서 */
  order: number;
  title: string;
  status: RolloutStatus;
  /** 판정 근거 + 다음에 할 일 */
  detail: string;
  /** 이 단계를 끝난 것으로 볼 수 있는가 (`connected`만) */
  done: boolean;
  /** 이 단계를 붙이기 위해 설정할 환경변수 */
  env: string[];
  /** `connected` 판정의 근거 (없으면 null) */
  evidence: string | null;
}

export interface RolloutJudgement {
  /** 확정된 순서 (표시용) */
  order: ProviderRolloutStage[];
  stages: RolloutStageView[];
  /** 지금 붙일 단계 — 전부 끝났으면 null */
  next: ProviderRolloutStage | null;
  /**
   * 앞 단계가 끝나지 않았는데 먼저 붙은 단계.
   *
   * **차단하지 않습니다.** 순서는 진행 지침이고, 이미 붙은 것을 끊으면
   * 돌아가던 것이 멈춥니다 — 경보와 차단은 다릅니다(결정 1301-⑤ 계열).
   * 다만 사실은 말합니다.
   */
  outOfOrder: ProviderRolloutStage[];
  summary: { connected: number; total: number };
  detail: string;
}

const STAGE_TITLE: Record<ProviderRolloutStage, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  vision: "Vision (멀티모달 이미지 분석)",
  ocr: "OCR (이미지 텍스트 추출)",
};

const LLM_STAGE_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
};

/** 운영 표준 OCR 엔진 이름 (그 외는 개발용이거나 미구현) */
export const PRODUCTION_OCR_PROVIDER = "google-vision";

/** 개발용 선택 OCR 엔진 (CTO 결정 2401-⑤) — 운영 연결로 세지 않는다 */
export const DEV_ONLY_OCR_PROVIDERS = ["tesseract"];

export const GOOGLE_VISION_KEY_ENV = "GOOGLE_VISION_API_KEY";
export const OCR_PROVIDER_ENV = "OCR_PROVIDER";

/**
 * 연결 근거로 인정하는 성공 기록의 기한 (일).
 *
 * 고정값입니다 — 환경변수로 열면 "일단 길게 잡아 두는" 우회가 생기고,
 * 그러면 오래전에 끊긴 연결이 계속 초록으로 남습니다.
 */
export const ROLLOUT_EVIDENCE_WINDOW_DAYS = 30;

export interface RolloutInput {
  env: Record<string, string | undefined>;
  /** LLM Provider별 **성공한** 실 호출 수 (mock 제외) */
  llmSuccesses: Record<string, number>;
  /** `vision-analysis` 기능으로 성공한 실 호출 수 (mock 제외) */
  visionSuccesses: number;
  /** OCR Provider별 성공한 실행 수 */
  ocrSuccesses: Record<string, number>;
}

/** 실행 기록 수를 근거 문장으로 — 0이면 근거가 없다 */
function evidenceOf(successes: number, what: string): string | null {
  return successes > 0
    ? `최근 ${ROLLOUT_EVIDENCE_WINDOW_DAYS}일 ${what} 성공 ${successes}건`
    : null;
}

function judgeLlmStage(
  stage: "openai" | "anthropic" | "gemini",
  input: RolloutInput,
): Omit<RolloutStageView, "order" | "title"> {
  const keyEnv = LLM_STAGE_ENV[stage];
  const format = validateApiKeyFormat(stage, input.env[keyEnv]);
  const successes = input.llmSuccesses[stage] ?? 0;
  const evidence = evidenceOf(successes, "실 호출");

  if (format.status === "missing") {
    return {
      stage,
      status: "not-configured",
      // 미구성과 실패는 다르다 — 아직 안 붙인 것을 장애로 말하지 않는다
      detail: `${keyEnv}가 없습니다 — 아직 붙이지 않은 상태입니다(실패가 아닙니다).`,
      done: false,
      env: [keyEnv],
      evidence: null,
    };
  }
  if (format.status !== "ok") {
    return {
      stage,
      status: "invalid",
      detail: `${keyEnv} ${format.message} (앞자리 ${format.hint ?? "-"} · ${format.length ?? 0}자)`,
      done: false,
      env: [keyEnv],
      evidence: null,
    };
  }
  if (successes > 0) {
    return {
      stage,
      status: "connected",
      detail:
        `최근 ${ROLLOUT_EVIDENCE_WINDOW_DAYS}일 안에 성공한 실 호출이 ${successes}건 있습니다 — ` +
        "연결이 사실로 확인됐습니다.",
      done: true,
      env: [keyEnv],
      evidence,
    };
  }
  return {
    stage,
    status: "unverified",
    // 형식 검사는 유효성 보장이 아니다 — 모르는 것을 연결됨으로 세지 않는다
    detail:
      `${keyEnv} 형식은 확인했지만 최근 ${ROLLOUT_EVIDENCE_WINDOW_DAYS}일 안에 성공한 실 호출 기록이 없습니다 — ` +
      "실제로 붙는지는 아직 모릅니다. Live Check(POST /ops/checks/run?job=provider-smoke) 또는 " +
      "실제 생성 1회로 확인하세요.",
    done: false,
    env: [keyEnv],
    evidence: null,
  };
}

function judgeVisionStage(
  input: RolloutInput,
): Omit<RolloutStageView, "order" | "title"> {
  const provider = (input.env.LLM_PROVIDER ?? "mock").trim().toLowerCase();
  const env = ["LLM_PROVIDER", "LLM_MODEL_VISION"];

  // Vision은 **별도 키가 없다** — LLM Gateway를 그대로 탄다.
  // 그래서 앞의 세 단계 중 무엇이 붙었는지가 Vision의 전제다.
  if (provider === "mock") {
    return {
      stage: "vision",
      status: "mock",
      detail:
        "LLM_PROVIDER가 mock이라 Vision도 가짜 결과를 만듭니다 — Vision은 별도 키가 없고 " +
        "LLM Gateway를 그대로 탑니다. 앞 단계(OpenAI·Anthropic·Gemini) 중 하나를 먼저 붙이세요.",
      done: false,
      env,
      evidence: null,
    };
  }
  if (input.visionSuccesses > 0) {
    return {
      stage: "vision",
      status: "connected",
      detail:
        `${provider}로 최근 ${ROLLOUT_EVIDENCE_WINDOW_DAYS}일 vision-analysis 성공이 ${input.visionSuccesses}건 있습니다 — ` +
        "이미지가 실제로 첨부되어 판정됐습니다.",
      done: true,
      env,
      evidence: evidenceOf(input.visionSuccesses, "vision-analysis"),
    };
  }
  return {
    stage: "vision",
    status: "unverified",
    detail:
      `LLM_PROVIDER=${provider}이지만 최근 ${ROLLOUT_EVIDENCE_WINDOW_DAYS}일 vision-analysis 성공 기록이 없습니다 — ` +
      "이미지 첨부 경로는 Provider마다 다르므로(형식이 하나만 틀려도 이미지가 조용히 빠집니다) " +
      "상품 조립을 1회 돌려 확인하세요.",
    done: false,
    env,
    evidence: null,
  };
}

function judgeOcrStage(
  input: RolloutInput,
): Omit<RolloutStageView, "order" | "title"> {
  const name = (input.env[OCR_PROVIDER_ENV] ?? "mock").trim().toLowerCase();
  const env = [OCR_PROVIDER_ENV, GOOGLE_VISION_KEY_ENV];

  if (name === "mock") {
    return {
      stage: "ocr",
      status: "mock",
      detail:
        `${OCR_PROVIDER_ENV}가 mock입니다 — 이미지에서 실제로 글자를 읽지 않고 ` +
        "가짜 텍스트를 만듭니다. 그 텍스트로 조립된 상품은 사실이 아닙니다.",
      done: false,
      env,
      evidence: null,
    };
  }
  if (DEV_ONLY_OCR_PROVIDERS.includes(name)) {
    return {
      stage: "ocr",
      status: "dev-only",
      detail:
        `${name}은 개발용 선택 엔진입니다(CTO 결정 2401-⑤) — 실제로 글자를 읽지만 ` +
        `운영 연결로 세지 않습니다. 운영 표준은 ${PRODUCTION_OCR_PROVIDER}입니다.`,
      done: false,
      env,
      evidence: evidenceOf(input.ocrSuccesses[name] ?? 0, "OCR 실행"),
    };
  }
  if (name !== PRODUCTION_OCR_PROVIDER) {
    return {
      stage: "ocr",
      status: "invalid",
      detail:
        `알 수 없는 ${OCR_PROVIDER_ENV} 값입니다: ${name} — 구현된 엔진은 ` +
        `${PRODUCTION_OCR_PROVIDER}(운영) · ${DEV_ONLY_OCR_PROVIDERS.join("·")}(개발) · mock입니다. ` +
        "운영에서는 기동이 차단됩니다(조용히 mock으로 대체하지 않습니다).",
      done: false,
      env,
      evidence: null,
    };
  }

  const format = validateApiKeyFormat(
    PRODUCTION_OCR_PROVIDER,
    input.env[GOOGLE_VISION_KEY_ENV],
  );
  const successes = input.ocrSuccesses[PRODUCTION_OCR_PROVIDER] ?? 0;
  if (format.status === "missing") {
    return {
      stage: "ocr",
      status: "not-configured",
      detail: `${PRODUCTION_OCR_PROVIDER}을 선택했지만 ${GOOGLE_VISION_KEY_ENV}가 없습니다 — 기동이 차단됩니다.`,
      done: false,
      env,
      evidence: null,
    };
  }
  if (format.status !== "ok") {
    return {
      stage: "ocr",
      status: "invalid",
      detail: `${GOOGLE_VISION_KEY_ENV} ${format.message} (앞자리 ${format.hint ?? "-"} · ${format.length ?? 0}자)`,
      done: false,
      env,
      evidence: null,
    };
  }
  if (successes > 0) {
    return {
      stage: "ocr",
      status: "connected",
      detail: `${PRODUCTION_OCR_PROVIDER}로 최근 ${ROLLOUT_EVIDENCE_WINDOW_DAYS}일 OCR 성공이 ${successes}건 있습니다.`,
      done: true,
      env,
      evidence: evidenceOf(successes, "OCR 실행"),
    };
  }
  return {
    stage: "ocr",
    status: "unverified",
    detail:
      `${GOOGLE_VISION_KEY_ENV} 형식은 확인했지만 최근 ${ROLLOUT_EVIDENCE_WINDOW_DAYS}일 OCR 성공 기록이 없습니다 — ` +
      "이미지 1장으로 POST /images/:id/ocr을 돌려 확인하세요.",
    done: false,
    env,
    evidence: null,
  };
}

/**
 * 단계별 상태를 판정한다 (순수 함수).
 *
 * 순서를 지키지 않은 진행은 **막지 않고 말합니다** — 이미 붙어서 돌아가는
 * 것을 끊으면 잘 되던 것이 멈추고, 그것은 순서를 지키는 것보다 나쁩니다.
 */
export function judgeProviderRollout(input: RolloutInput): RolloutJudgement {
  const stages: RolloutStageView[] = PROVIDER_ROLLOUT_ORDER.map(
    (stage, index) => {
      const judged =
        stage === "vision"
          ? judgeVisionStage(input)
          : stage === "ocr"
            ? judgeOcrStage(input)
            : judgeLlmStage(stage, input);
      return { ...judged, order: index + 1, title: STAGE_TITLE[stage] };
    },
  );

  const firstUnfinished = stages.findIndex((view) => !view.done);
  const next = firstUnfinished === -1 ? null : stages[firstUnfinished].stage;
  const outOfOrder =
    firstUnfinished === -1
      ? []
      : stages
          .slice(firstUnfinished + 1)
          .filter((view) => view.done)
          .map((view) => view.stage);

  const connected = stages.filter((view) => view.done).length;
  return {
    order: [...PROVIDER_ROLLOUT_ORDER],
    stages,
    next,
    outOfOrder,
    summary: { connected, total: stages.length },
    detail: describeProviderRollout(stages, next, outOfOrder),
  };
}

/** 한 줄 요약 — 지금 어디까지이고 다음에 무엇을 할지 */
export function describeProviderRollout(
  stages: RolloutStageView[],
  next: ProviderRolloutStage | null,
  outOfOrder: ProviderRolloutStage[],
): string {
  const connected = stages.filter((view) => view.done).length;
  const head = `연결 완료 ${connected}/${stages.length}단계`;
  const tail =
    next === null
      ? " — 확정된 순서의 모든 단계가 연결됐습니다."
      : ` — 다음 단계는 ${STAGE_TITLE[next]}입니다. ` +
        (stages.find((view) => view.stage === next)?.detail ?? "");
  // 순서를 벗어난 진행은 사실로만 적는다 (차단하지 않는다)
  const note =
    outOfOrder.length > 0
      ? ` 확정 순서보다 먼저 붙은 단계가 있습니다: ${outOfOrder
          .map((stage) => STAGE_TITLE[stage])
          .join(", ")} — 막지는 않습니다.`
      : "";
  return head + tail + note;
}

/**
 * 가짜가 돌고 있는 단계 — 운영에서 이 상태면 **결과가 사실이 아닙니다.**
 *
 * 배포를 막지는 않습니다(결정 1301-⑤ 계열: 경보와 차단은 다릅니다). 다만
 * 운영 화면이 이 사실을 말해야 합니다 — 가짜 OCR로 조립된 상품이 진짜처럼
 * 검수를 통과하는 것이 이 프로젝트에서 가장 위험한 조용한 실패입니다.
 */
export function mockStages(judgement: RolloutJudgement): RolloutStageView[] {
  return judgement.stages.filter((view) => view.status === "mock");
}

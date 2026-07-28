import {
  experimentKey,
  LLM_FEATURE_EXPERIMENT_ENV,
  MIN_SAMPLES_FOR_RECOMMENDATION,
  parseExperiment,
} from "@acos/core";
import type { Experiment } from "@acos/core";

/**
 * Routing Experiment 환경 설정. (TASK-1003, Sprint 10)
 *
 * - `LLM_EXPERIMENT_CONTENT` / `LLM_EXPERIMENT_ANALYSIS` /
 *   `LLM_EXPERIMENT_VISION` = `이름|종류|변형=가중치,변형=가중치`
 *   (이름·종류 생략 가능 — 예: `openai=90,anthropic=10`)
 * - **미설정이면 실험 없음** — 기존 라우팅 그대로 (기본 동작 보존)
 *
 * 라우팅·Failover와 마찬가지로 **호출 시점마다 읽는다** (재기동 없이 반영).
 */

/** 실험 정의 원문 — 콘솔 오버라이드 > 환경변수 (TASK-1201) */
function experimentDefinition(
  feature: string,
  settings?: (key: string) => string | null,
): string | undefined {
  const override = settings?.(experimentKey(feature));
  if (override !== null && override !== undefined) {
    return override;
  }
  const env = LLM_FEATURE_EXPERIMENT_ENV[feature];
  return env ? process.env[env] : undefined;
}

/** feature 하나의 실험 설정 (미설정이면 null) */
export function featureExperiment(
  feature?: string,
  settings?: (key: string) => string | null,
): Experiment | null {
  if (!feature || !LLM_FEATURE_EXPERIMENT_ENV[feature]) {
    return null;
  }
  return parseExperiment(feature, experimentDefinition(feature, settings));
}

/** 설정된 실험 전체 (Experiment Dashboard) */
export function allExperiments(
  settings?: (key: string) => string | null,
): Experiment[] {
  return Object.keys(LLM_FEATURE_EXPERIMENT_ENV)
    .map((feature) =>
      parseExperiment(feature, experimentDefinition(feature, settings)),
    )
    .filter((experiment): experiment is Experiment => experiment !== null);
}

/**
 * 승자 추천에 필요한 변형별 최소 호출 수 (CTO 결정 1102-①).
 * 기본 30회를 유지하되 `LLM_EXPERIMENT_MIN_SAMPLES`로 조정할 수 있다.
 */
export function minSamplesForRecommendation(): number {
  const parsed = Number(process.env.LLM_EXPERIMENT_MIN_SAMPLES);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : MIN_SAMPLES_FOR_RECOMMENDATION;
}

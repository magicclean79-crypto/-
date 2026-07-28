import { LLM_FEATURE_EXPERIMENT_ENV, parseExperiment } from "@acos/core";
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

/** feature 하나의 실험 설정 (미설정이면 null) */
export function featureExperiment(feature?: string): Experiment | null {
  if (!feature) {
    return null;
  }
  const env = LLM_FEATURE_EXPERIMENT_ENV[feature];
  return env ? parseExperiment(feature, process.env[env]) : null;
}

/** 설정된 실험 전체 (Experiment Dashboard) */
export function allExperiments(): Experiment[] {
  return Object.entries(LLM_FEATURE_EXPERIMENT_ENV)
    .map(([feature, env]) => parseExperiment(feature, process.env[env]))
    .filter((experiment): experiment is Experiment => experiment !== null);
}

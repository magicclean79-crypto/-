import {
  LLM_FEATURE_MODEL_ENV,
  LLM_FEATURE_PROVIDER_ENV,
  parseRoutingRule,
  ROUTABLE_FEATURES,
} from "@acos/core";
import type { RoutingRule } from "@acos/core";

/**
 * 라우팅 환경 설정 해석. (TASK-1001, Sprint 10)
 *
 * - `LLM_ROUTE_CONTENT` / `LLM_ROUTE_ANALYSIS` / `LLM_ROUTE_VISION`
 *   = `provider` 또는 `provider:model` — feature별 Provider 매핑
 * - `LLM_MODEL_CONTENT` / `_ANALYSIS` / `_VISION` = 모델만 지정 (0902) —
 *   같은 Provider일 때만 적용된다
 *
 * **호출 시점마다 읽는다** (Dynamic Routing — 환경 변경이 재기동 없이 반영).
 */

/** feature → 라우팅 규칙 (미설정은 null) */
export function routingRules(): Record<string, RoutingRule | null> {
  const rules: Record<string, RoutingRule | null> = {};
  for (const feature of ROUTABLE_FEATURES) {
    const env = LLM_FEATURE_PROVIDER_ENV[feature];
    rules[feature] = parseRoutingRule(env ? process.env[env] : undefined);
  }
  return rules;
}

/** feature → 모델 오버라이드 (미설정은 null) */
export function routingModelOverrides(): Record<string, string | null> {
  const overrides: Record<string, string | null> = {};
  for (const [feature, env] of Object.entries(LLM_FEATURE_MODEL_ENV)) {
    overrides[feature] = process.env[env] ?? null;
  }
  return overrides;
}

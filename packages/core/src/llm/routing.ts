/**
 * Cross-Provider Routing Engine. (TASK-1001, Sprint 10)
 *
 * feature별로 어떤 Provider·모델을 쓸지 결정하는 순수 로직.
 * CTO 결정(TASK-0902 승인 ②)에 따라 Provider 내부 모델 선택에서
 * **Provider 자체를 feature별로 분리**하는 단계로 확장한다.
 *
 * 원칙:
 * - **Dynamic**: 호출 시점에 매번 해석한다 (환경 변경이 재기동 없이 반영)
 * - **Graceful degradation**: 매핑된 Provider를 쓸 수 없으면(키 미설정 등)
 *   기본 Provider로 내려간다 — 호출을 실패시키지 않는다.
 *   단, 이는 **설정 해석 시점의 폴백**이며 호출 실패 시 재시도/전환
 *   (Provider Failover)은 이번 범위가 아니다 (CTO 지시 — 범위 제외)
 * - 모델 오버라이드(`LLM_MODEL_*`)는 **같은 Provider일 때만** 적용한다
 *   (다른 Provider의 모델명을 넘기면 호출이 깨지므로)
 */

/** 라우팅 대상 feature — "dev"(개발용 호출)는 항상 기본 Provider */
export const ROUTABLE_FEATURES = [
  "content-generation",
  "product-analysis",
  "vision-analysis",
  "design-review",
] as const;

export type RoutableFeature = (typeof ROUTABLE_FEATURES)[number];

/** feature별 Provider 지정 환경변수 (값: "provider" 또는 "provider:model") */
export const LLM_FEATURE_PROVIDER_ENV: Record<string, string> = {
  "content-generation": "LLM_ROUTE_CONTENT",
  "product-analysis": "LLM_ROUTE_ANALYSIS",
  "vision-analysis": "LLM_ROUTE_VISION",
  // "디자인 리뷰는 Gemini가 맡는다"(CTO 역할 분담) — 이 환경변수를
  // "gemini"로 설정하면 코드 변경 없이 design-review 호출이 Gemini로
  // 라우팅된다. 키가 없으면 자동으로 기본 Provider로 내려간다(§graceful
  // degradation) — 지금은 아직 설정하지 않았다.
  "design-review": "LLM_ROUTE_DESIGN_REVIEW",
};

export interface RoutingRule {
  provider: string;
  /** 규칙에 함께 지정된 모델 ("provider:model") — 없으면 null */
  model: string | null;
}

/** 라우팅 결정 근거 */
export type RoutingSource =
  /** feature 매핑 적용 */
  | "feature"
  /** 매핑 없음 — 기본 Provider */
  | "default"
  /** 매핑된 Provider를 쓸 수 없어 기본 Provider로 내려감 */
  | "fallback";

export interface RoutingResolution {
  feature: string;
  provider: string;
  /** 사용할 모델 — null이면 Provider 기본 모델 */
  model: string | null;
  source: RoutingSource;
  /** fallback 사유 (그 외 null) */
  reason: string | null;
}

/** "provider" 또는 "provider:model" 문자열 → 규칙 (빈 값은 null) */
export function parseRoutingRule(
  value: string | undefined | null,
): RoutingRule | null {
  const raw = (value ?? "").trim();
  if (!raw) {
    return null;
  }
  const [provider, ...rest] = raw.split(":");
  const name = provider.trim().toLowerCase();
  if (!name) {
    return null;
  }
  const model = rest.join(":").trim();
  return { provider: name, model: model.length > 0 ? model : null };
}

export interface RoutingInput {
  /** 호출 feature — 미지정/라우팅 대상 아님이면 기본 Provider */
  feature?: string;
  defaultProvider: string;
  /** feature → 규칙 (환경변수 해석 결과) */
  rules: Record<string, RoutingRule | null>;
  /** feature → 모델 오버라이드 (LLM_MODEL_*, 같은 Provider일 때만 적용) */
  modelOverrides?: Record<string, string | null>;
  /** 실제로 사용 가능한 Provider 이름 (키가 설정되어 인스턴스가 있는 것) */
  availableProviders: string[];
}

/** feature 하나에 대한 라우팅 결정 */
export function resolveRoute(input: RoutingInput): RoutingResolution {
  const feature = input.feature ?? "dev";
  const overrideModel = input.modelOverrides?.[feature] ?? null;
  const rule = input.rules[feature] ?? null;

  const onDefault = (
    source: RoutingSource,
    reason: string | null,
  ): RoutingResolution => ({
    feature,
    provider: input.defaultProvider,
    model: overrideModel,
    source,
    reason,
  });

  if (!rule) {
    return onDefault("default", null);
  }
  if (!input.availableProviders.includes(rule.provider)) {
    return onDefault(
      "fallback",
      `Provider "${rule.provider}"를 사용할 수 없어 기본 Provider로 처리했습니다 (API 키 미설정 등).`,
    );
  }
  return {
    feature,
    provider: rule.provider,
    // 다른 Provider로 라우팅된 경우 기본 Provider용 모델 오버라이드는 쓰지 않는다
    model:
      rule.model ??
      (rule.provider === input.defaultProvider ? overrideModel : null),
    source: "feature",
    reason: null,
  };
}

/** 라우팅 대상 feature 전체의 결정 (Routing Dashboard 표시용) */
export function buildRoutingTable(
  input: Omit<RoutingInput, "feature">,
): RoutingResolution[] {
  return ROUTABLE_FEATURES.map((feature) =>
    resolveRoute({ ...input, feature }),
  );
}

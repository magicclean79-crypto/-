/**
 * Routing Experiment & Traffic Control. (TASK-1003, Sprint 10)
 *
 * 라우팅(TASK-1001)이 feature → Provider **하나**를 정한다면, Experiment는
 * 같은 feature의 트래픽을 **여러 변형(variant)에 비율로 나눈다**.
 * Percentage / A·B / Canary / Weighted는 모두 "가중치 있는 변형 집합"이라는
 * 하나의 원리로 표현되며, 종류(kind)는 운영자가 **의도를 선언**하는 값이다
 * (대시보드 표시·검증 규칙에 쓰인다 — 선택 알고리즘은 동일).
 *
 * 형식: `LLM_EXPERIMENT_<FEATURE>` =
 *   `이름|종류|변형=가중치,변형=가중치` (이름·종류는 생략 가능)
 *   변형은 라우팅과 같은 `provider` 또는 `provider:model`
 *
 * 예)
 * - Percentage: `openai=90,anthropic=10`
 * - A/B:        `ab-4o-vs-sonnet|ab|openai:gpt-4o=50,anthropic:claude-sonnet-5=50`
 * - Canary:     `sonnet-canary|canary|openai:gpt-4o=95,anthropic:claude-sonnet-5=5`
 * - Weighted:   `weighted|openai=60,anthropic=30,gemini=10`
 *
 * 원칙:
 * - **Dynamic**: 라우팅과 동일하게 호출 시점마다 해석한다
 * - **Graceful degradation**: 쓸 수 없는 Provider의 변형은 제외하고 남은
 *   변형끼리 가중치를 재정규화한다. 전부 쓸 수 없으면 실험을 적용하지 않고
 *   기존 라우팅으로 내려간다 — 실험 설정이 호출을 실패시키지 않는다
 * - **무상태 배정**: 호출마다 독립적으로 추첨한다 (사용자·세션 고정 배정은
 *   별도 스펙 — 현재 LLM 호출 계층은 주체 식별자를 갖지 않는다)
 */

/** 실험 종류 — 선택 알고리즘은 같고, 의도 선언과 검증 규칙이 다르다 */
export const EXPERIMENT_KINDS = [
  "percentage",
  "ab",
  "canary",
  "weighted",
] as const;

export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number];

/** feature별 실험 지정 환경변수 */
export const LLM_FEATURE_EXPERIMENT_ENV: Record<string, string> = {
  "content-generation": "LLM_EXPERIMENT_CONTENT",
  "product-analysis": "LLM_EXPERIMENT_ANALYSIS",
  "vision-analysis": "LLM_EXPERIMENT_VISION",
};

export interface ExperimentVariant {
  provider: string;
  /** 변형에 지정된 모델 — null이면 Provider 기본 모델 */
  model: string | null;
  /** 설정된 가중치 (양수) */
  weight: number;
}

export interface Experiment {
  feature: string;
  name: string;
  kind: ExperimentKind;
  variants: ExperimentVariant[];
}

/** 변형 식별자 — 지표 집계·대시보드의 키 (`provider` 또는 `provider:model`) */
export function variantKey(variant: {
  provider: string;
  model: string | null;
}): string {
  return variant.model ? `${variant.provider}:${variant.model}` : variant.provider;
}

function parseVariants(raw: string): ExperimentVariant[] {
  const variants: ExperimentVariant[] = [];
  for (const part of raw.split(",")) {
    const [target, weightText] = part.split("=");
    const spec = (target ?? "").trim();
    if (!spec) {
      continue;
    }
    // 가중치 생략 시 1 (균등 분배) — `openai,anthropic`도 유효한 A/B 설정
    const weight = weightText === undefined ? 1 : Number(weightText.trim());
    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    const [provider, ...rest] = spec.split(":");
    const name = provider.trim().toLowerCase();
    if (!name) {
      continue;
    }
    const model = rest.join(":").trim();
    variants.push({
      provider: name,
      model: model.length > 0 ? model : null,
      weight,
    });
  }
  return variants;
}

/** 변형 수·가중치로 종류를 추정한다 (설정에 종류가 없을 때) */
function inferKind(variants: ExperimentVariant[]): ExperimentKind {
  if (variants.length !== 2) {
    return "weighted";
  }
  const total = variants.reduce((sum, item) => sum + item.weight, 0);
  const minShare = Math.min(...variants.map((item) => item.weight)) / total;
  // 한쪽이 10% 이하로 아주 작으면 Canary, 그 외 2종 분할은 A/B
  return minShare <= 0.1 ? "canary" : "ab";
}

/**
 * `이름|종류|변형=가중치,…` 문자열 → 실험 (빈 값·유효 변형 없음이면 null).
 * 이름·종류는 생략 가능하며, 순서와 무관하게 해석한다.
 */
export function parseExperiment(
  feature: string,
  value: string | undefined | null,
): Experiment | null {
  const raw = (value ?? "").trim();
  if (!raw) {
    return null;
  }
  const segments = raw.split("|").map((segment) => segment.trim());
  // 변형 목록은 항상 마지막 조각 (`=` 또는 `,`가 없는 단일 provider도 허용)
  const variants = parseVariants(segments[segments.length - 1] ?? "");
  if (variants.length === 0) {
    return null;
  }
  const head = segments.slice(0, -1);
  const kind = head.find((segment) =>
    (EXPERIMENT_KINDS as readonly string[]).includes(segment.toLowerCase()),
  );
  const name = head.find((segment) => segment !== kind);
  return {
    feature,
    name: name && name.length > 0 ? name : feature,
    kind: (kind?.toLowerCase() as ExperimentKind | undefined) ?? inferKind(variants),
    variants,
  };
}

export interface ExperimentAssignment {
  /** 선택된 변형 */
  variant: ExperimentVariant;
  /** 집계 키 */
  key: string;
  /** 사용 가능한 변형만 남긴 뒤의 실제 배정 확률 (0~1) */
  share: number;
}

/**
 * 가중치 추첨. `random`은 0 이상 1 미만 (테스트에서 주입 가능).
 * 사용 가능한 변형이 없으면 null — 호출자는 기존 라우팅으로 내려간다.
 */
export function pickVariant(
  variants: ExperimentVariant[],
  options: {
    availableProviders: string[];
    random?: () => number;
  },
): ExperimentAssignment | null {
  const usable = variants.filter((variant) =>
    options.availableProviders.includes(variant.provider),
  );
  const total = usable.reduce((sum, item) => sum + item.weight, 0);
  if (usable.length === 0 || total <= 0) {
    return null;
  }
  const random = options.random ?? Math.random;
  const roll = Math.min(Math.max(random(), 0), 0.999_999_999) * total;
  let cursor = 0;
  for (const variant of usable) {
    cursor += variant.weight;
    if (roll < cursor) {
      return {
        variant,
        key: variantKey(variant),
        share: variant.weight / total,
      };
    }
  }
  const last = usable[usable.length - 1];
  return { variant: last, key: variantKey(last), share: last.weight / total };
}

export interface ExperimentVariantView extends ExperimentVariant {
  key: string;
  /** 설정된 가중치의 비율 (전체 대비) */
  weightShare: number;
  /** 이 Provider를 실제로 쓸 수 있는지 */
  available: boolean;
  /** 사용 불가 변형을 제외하고 재정규화한 실제 배정 비율 */
  effectiveShare: number;
}

export interface ExperimentView {
  feature: string;
  name: string;
  kind: ExperimentKind;
  env: string;
  /** 사용 가능한 변형이 하나라도 있어 실제로 트래픽이 나뉘는지 */
  active: boolean;
  variants: ExperimentVariantView[];
  /** 비활성 사유 (활성이면 null) */
  reason: string | null;
}

/** 실험 하나의 표시용 해석 (Experiment Dashboard) */
export function describeExperiment(
  experiment: Experiment,
  availableProviders: string[],
): ExperimentView {
  const totalWeight = experiment.variants.reduce(
    (sum, item) => sum + item.weight,
    0,
  );
  const usableWeight = experiment.variants
    .filter((item) => availableProviders.includes(item.provider))
    .reduce((sum, item) => sum + item.weight, 0);
  const variants = experiment.variants.map((variant) => {
    const available = availableProviders.includes(variant.provider);
    return {
      ...variant,
      key: variantKey(variant),
      weightShare: totalWeight > 0 ? variant.weight / totalWeight : 0,
      available,
      effectiveShare:
        available && usableWeight > 0 ? variant.weight / usableWeight : 0,
    };
  });
  const unusable = variants.filter((variant) => !variant.available);
  return {
    feature: experiment.feature,
    name: experiment.name,
    kind: experiment.kind,
    env: LLM_FEATURE_EXPERIMENT_ENV[experiment.feature] ?? "",
    active: usableWeight > 0,
    variants,
    reason:
      usableWeight <= 0
        ? "사용 가능한 변형이 없어 실험을 적용하지 않고 기존 라우팅으로 처리합니다 (API 키 미설정 등)."
        : unusable.length > 0
          ? `사용할 수 없는 변형(${unusable.map((item) => item.key).join(", ")})을 제외하고 나머지 가중치로 분배합니다.`
          : null,
  };
}

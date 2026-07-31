import { LLM_FEATURE_EXPERIMENT_ENV, parseExperiment } from "../llm/experiment";
import {
  PROMOTION_ENABLED_KEY,
  PROMOTION_SETTING_KEY,
  resolvePromotionSettings,
} from "../ops/incident-promotion";
import { validateThreshold } from "../ops/kpi-thresholds";
import { validateRetention } from "../ops/retention";
import { LLM_PROVIDER_REGISTRY } from "../llm/provider-registry";
import { LLM_FEATURE_MODEL_ENV } from "../llm/provider-registry";

/**
 * Provider Administration Console 설정. (TASK-1201, Sprint 12)
 *
 * 설정 원칙은 그대로 **Code-first(환경변수)** 다. 콘솔은 그 위에 얹는
 * **운영 오버라이드**이며, 값을 지우면 환경변수로 되돌아간다. 오버라이드가
 * 하나도 없으면 기존 동작과 완전히 같다.
 *
 * ```
 * 유효값 = 오버라이드(DB) ?? 환경변수 ?? 기본값
 * ```
 *
 * 키는 **한 종류의 문자열 네임스페이스**로 통일했다 — 관리 영역이 넷이지만
 * 저장·감사·조회 경로를 하나로 두는 편이 어긋날 여지가 적다.
 */

/** 설정 값의 출처 — 화면에서 "무엇이 지금 적용 중인지"를 드러낸다 */
export type SettingSource = "override" | "env" | "default";

export interface ResolvedSetting {
  key: string;
  value: string | null;
  source: SettingSource;
  /** 오버라이드를 지웠을 때 되돌아갈 값 (환경변수 또는 기본값) */
  fallback: string | null;
  /** 대응하는 환경변수명 (있으면) */
  env: string | null;
}

export const SETTING_KEY_PATTERNS = {
  /** provider.<name>.enabled = "true" | "false" */
  providerEnabled: /^provider\.([a-z0-9-]+)\.enabled$/,
  /** model.<feature> = 모델명 */
  model: /^model\.([a-z0-9-]+)$/,
  /** budget.daily | budget.monthly | budget.alertRatio */
  budget: /^budget\.(daily|monthly|alertRatio)$/,
  /** experiment.<feature> = `이름|종류|변형=가중치,…` */
  experiment: /^experiment\.([a-z0-9-]+)$/,
} as const;

export function providerEnabledKey(provider: string): string {
  return `provider.${provider}.enabled`;
}
export function modelKey(feature: string): string {
  return `model.${feature}`;
}
export function experimentKey(feature: string): string {
  return `experiment.${feature}`;
}

export class SettingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingValidationError";
  }
}

const ROUTABLE_FEATURE_KEYS = Object.keys(LLM_FEATURE_EXPERIMENT_ENV);

/**
 * 설정 키·값 검증. 잘못된 값이 저장되면 다음 호출부터 라우팅이 깨지므로
 * **저장 시점에** 막는다. `value === null`은 오버라이드 해제(항상 허용).
 */
export function validateSetting(key: string, value: string | null): void {
  const providerMatch = SETTING_KEY_PATTERNS.providerEnabled.exec(key);
  if (providerMatch) {
    const name = providerMatch[1];
    if (!LLM_PROVIDER_REGISTRY.some((info) => info.name === name)) {
      throw new SettingValidationError(
        `알 수 없는 Provider입니다: ${name} (${LLM_PROVIDER_REGISTRY.map((i) => i.name).join(", ")})`,
      );
    }
    if (value !== null && value !== "true" && value !== "false") {
      throw new SettingValidationError(
        `Provider 활성 값은 "true" 또는 "false"여야 합니다 (받은 값: ${value}).`,
      );
    }
    return;
  }

  const modelMatch = SETTING_KEY_PATTERNS.model.exec(key);
  if (modelMatch) {
    if (!ROUTABLE_FEATURE_KEYS.includes(modelMatch[1])) {
      throw new SettingValidationError(
        `모델 지정 대상 feature가 아닙니다: ${modelMatch[1]} (${ROUTABLE_FEATURE_KEYS.join(", ")})`,
      );
    }
    if (value !== null && value.trim().length === 0) {
      throw new SettingValidationError(
        "모델명이 비어 있습니다 — 해제하려면 값을 비우지 말고 오버라이드를 삭제하세요.",
      );
    }
    return;
  }

  const budgetMatch = SETTING_KEY_PATTERNS.budget.exec(key);
  if (budgetMatch) {
    if (value === null) {
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new SettingValidationError(
        `예산 값은 0보다 큰 숫자여야 합니다 (받은 값: ${value}).`,
      );
    }
    if (budgetMatch[1] === "alertRatio" && parsed > 1) {
      throw new SettingValidationError(
        `경고 임계는 0과 1 사이여야 합니다 (받은 값: ${value}).`,
      );
    }
    return;
  }

  const experimentMatch = SETTING_KEY_PATTERNS.experiment.exec(key);
  if (experimentMatch) {
    const feature = experimentMatch[1];
    if (!ROUTABLE_FEATURE_KEYS.includes(feature)) {
      throw new SettingValidationError(
        `실험 대상 feature가 아닙니다: ${feature} (${ROUTABLE_FEATURE_KEYS.join(", ")})`,
      );
    }
    if (value !== null && parseExperiment(feature, value) === null) {
      throw new SettingValidationError(
        `실험 정의를 해석할 수 없습니다: "${value}" — 형식은 \`이름|종류|변형=가중치,…\` 입니다.`,
      );
    }
    return;
  }

  // 운영 설정 (TASK-3901, CTO 정책 3901-②③⑤) — 판정 규칙은 ops 쪽에 있고
  // 여기서는 그 판정을 그대로 쓴다. 검증을 두 곳에 두면 언젠가 갈라진다.
  if (key.startsWith("kpi.threshold.")) {
    const check = validateThreshold(key, value);
    if (!check.ok) {
      throw new SettingValidationError(check.reason);
    }
    return;
  }
  if (key.startsWith("retention.")) {
    const check = validateRetention(key, value);
    if (!check.ok) {
      throw new SettingValidationError(check.reason);
    }
    return;
  }
  if (key === PROMOTION_ENABLED_KEY) {
    if (value !== null && value !== "true" && value !== "false") {
      throw new SettingValidationError(
        `자동 승격 값은 "true" 또는 "false"여야 합니다 (받은 값: ${value}).`,
      );
    }
    return;
  }
  if (key === PROMOTION_SETTING_KEY) {
    if (value === null) {
      return;
    }
    const rejected = resolvePromotionSettings({ [key]: value }).rejected;
    if (rejected.length > 0) {
      throw new SettingValidationError(rejected[0].reason);
    }
    return;
  }

  throw new SettingValidationError(
    `지원하지 않는 설정 키입니다: ${key} (provider.<name>.enabled / model.<feature> / budget.daily|monthly|alertRatio / experiment.<feature> / kpi.threshold.<id>.<good|watch> / retention.<target>.days / incident.promotion.*)`,
  );
}

/** 오버라이드 → 환경변수 → 기본값 순으로 유효값을 정한다 */
export function resolveSetting(input: {
  key: string;
  override: string | null | undefined;
  envName?: string | null;
  envValue?: string | null | undefined;
  defaultValue?: string | null;
}): ResolvedSetting {
  const fallback = input.envValue ?? input.defaultValue ?? null;
  if (input.override !== null && input.override !== undefined) {
    return {
      key: input.key,
      value: input.override,
      source: "override",
      fallback,
      env: input.envName ?? null,
    };
  }
  if (input.envValue !== null && input.envValue !== undefined) {
    return {
      key: input.key,
      value: input.envValue,
      source: "env",
      fallback: input.defaultValue ?? null,
      env: input.envName ?? null,
    };
  }
  return {
    key: input.key,
    value: input.defaultValue ?? null,
    source: "default",
    fallback: null,
    env: input.envName ?? null,
  };
}

/**
 * Provider 사용 가능 여부 — 콘솔에서 끈 Provider는 라우팅·실험·Failover
 * 후보에서 빠진다. **마지막 하나는 끌 수 없다**(전부 꺼지면 호출이 전멸한다).
 */
export function enabledProviders(input: {
  available: string[];
  isDisabled: (provider: string) => boolean;
}): string[] {
  const enabled = input.available.filter(
    (provider) => !input.isDisabled(provider),
  );
  return enabled.length > 0 ? enabled : input.available;
}

/** 모델 지정 환경변수명 (Model Management 표시용) */
export function modelEnvName(feature: string): string | null {
  return LLM_FEATURE_MODEL_ENV[feature] ?? null;
}

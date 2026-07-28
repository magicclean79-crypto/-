import { LLM_PROVIDER_REGISTRY } from "./provider-registry";

/**
 * API Key Validation. (TASK-1301, Sprint 13)
 *
 * 실제 Provider로 운영하기 전에 **키가 그럴듯한지 먼저 본다**. 형식 검사는
 * 네트워크 없이 즉시 되므로, 오타·잘린 값·플레이스홀더를 배포 전에 잡는다.
 * 다만 형식이 맞아도 **유효하다는 보장은 아니므로**, 실제 유효성은 Provider
 * 호출(Live Check)로만 확인한다 — 이 파일은 그 둘을 명확히 구분한다.
 *
 * 키 값은 절대 반환하지 않는다. 노출은 **접두사 일부 + 길이**까지만.
 */

export type ApiKeyFormatStatus =
  /** 형식이 그럴듯함 (유효하다는 뜻은 아니다) */
  | "ok"
  /** 미설정 */
  | "missing"
  /** 형식이 명백히 틀림 */
  | "invalid"
  /** 예시·플레이스홀더로 보임 */
  | "placeholder";

export interface ApiKeyFormatResult {
  provider: string;
  status: ApiKeyFormatStatus;
  /** 사람이 읽는 판정 근거 */
  message: string;
  /** 키 앞부분만 (없으면 null) — 어떤 키가 들어갔는지 식별용 */
  hint: string | null;
  length: number | null;
}

/** 명백한 예시/플레이스홀더 패턴 — 배포 사고의 단골 원인 */
const PLACEHOLDER_PATTERNS = [
  /^sk-(xxx+|your|test-?key|example|placeholder|invalid)/i,
  /^(your|my)[-_]?api[-_]?key/i,
  /^(changeme|todo|fixme|dummy|sample)/i,
  /^x{4,}$/i,
  /^\.{3,}$/,
];

interface KeyRule {
  /** 기대 접두사 (없으면 검사하지 않음) */
  prefix?: string;
  /** 최소 길이 */
  minLength: number;
  /** 형식 설명 (오류 메시지에 사용) */
  shape: string;
}

/**
 * Provider별 키 형식 규칙.
 * 접두사·길이는 공개된 관례에 기반한 **느슨한** 검사다 — Provider가 형식을
 * 바꿔도 오탐으로 배포를 막지 않도록 최소한만 본다.
 */
const KEY_RULES: Record<string, KeyRule> = {
  openai: { prefix: "sk-", minLength: 20, shape: "`sk-`로 시작하는 20자 이상" },
  anthropic: {
    prefix: "sk-ant-",
    minLength: 20,
    shape: "`sk-ant-`로 시작하는 20자 이상",
  },
  // Gemini 키는 고정 접두사가 없다 — 길이만 본다
  gemini: { minLength: 20, shape: "20자 이상" },
};

/** 키 앞부분만 보여 준다 (값 노출 금지) */
export function keyHint(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 6) {
    return "…";
  }
  return `${trimmed.slice(0, 6)}…`;
}

/**
 * 키 **형식** 검사 — 네트워크를 쓰지 않는다.
 * `ok`는 "형식이 그럴듯하다"는 뜻이며 유효성 보장이 아니다.
 */
export function validateApiKeyFormat(
  provider: string,
  key: string | undefined | null,
): ApiKeyFormatResult {
  const raw = (key ?? "").trim();
  if (raw.length === 0) {
    return {
      provider,
      status: "missing",
      message: "키가 설정되지 않았습니다.",
      hint: null,
      length: null,
    };
  }

  const base = {
    provider,
    hint: keyHint(raw),
    length: raw.length,
  };

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(raw))) {
    return {
      ...base,
      status: "placeholder",
      message:
        "예시·플레이스홀더로 보이는 값입니다 — 실제 키로 교체하세요.",
    };
  }

  // 공백이 섞인 키는 복사 과정에서 깨진 경우가 많다
  if (/\s/.test(raw)) {
    return {
      ...base,
      status: "invalid",
      message: "키에 공백이 포함되어 있습니다 — 복사 중 깨졌을 수 있습니다.",
    };
  }

  const rule = KEY_RULES[provider];
  if (!rule) {
    return { ...base, status: "ok", message: "형식 규칙이 없어 길이만 확인했습니다." };
  }
  if (rule.prefix && !raw.startsWith(rule.prefix)) {
    return {
      ...base,
      status: "invalid",
      message: `형식이 다릅니다 — ${rule.shape}이어야 합니다.`,
    };
  }
  if (raw.length < rule.minLength) {
    return {
      ...base,
      status: "invalid",
      message: `키가 너무 짧습니다 (${raw.length}자) — ${rule.shape}이어야 합니다.`,
    };
  }

  return {
    ...base,
    status: "ok",
    message: "형식 확인 — 실제 유효성은 Live Check로 확인하세요.",
  };
}

/** Registry에 등록된 Provider 전체의 키 형식 검사 */
export function validateAllApiKeyFormats(
  env: Record<string, string | undefined>,
): ApiKeyFormatResult[] {
  return LLM_PROVIDER_REGISTRY.filter((info) => info.keyEnv !== null).map(
    (info) => validateApiKeyFormat(info.name, env[info.keyEnv as string]),
  );
}

/**
 * 운영에서 이 Provider의 키가 필요한가 (CTO 결정 1202-②).
 * 기본 Provider·라우팅·Failover 우선순위·실험 변형 중 하나라도 참조하면 필요하다
 * — 설정 어디서든 쓰이는데 키가 없으면 그 경로는 실패하기 때문이다.
 */
export function providerKeyRequired(
  provider: string,
  env: Record<string, string | undefined>,
): boolean {
  if (provider === "mock") {
    return false;
  }
  const referenced = [
    env.LLM_PROVIDER,
    env.LLM_ROUTE_CONTENT,
    env.LLM_ROUTE_ANALYSIS,
    env.LLM_ROUTE_VISION,
    env.LLM_FAILOVER_PRIORITY,
    env.LLM_EXPERIMENT_CONTENT,
    env.LLM_EXPERIMENT_ANALYSIS,
    env.LLM_EXPERIMENT_VISION,
  ]
    .filter((value): value is string => Boolean(value))
    .join(",");

  // `openai`, `openai:gpt-4o`, `a,openai=90` 등 어떤 형태로든 등장하면 참조로 본다
  return new RegExp(`(^|[,|=:\\s])${provider}([,|=:\\s]|$)`).test(referenced);
}

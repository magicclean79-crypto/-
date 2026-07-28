/**
 * Environment Validation. (TASK-1202, Sprint 12)
 *
 * 운영에 필요한 환경변수를 **한 곳에 선언**하고, 그 선언으로 검증·문서·
 * 배포 체크리스트를 모두 만든다. 설정이 코드·문서·런북 세 곳에 흩어지면
 * 반드시 어긋나므로, 선언을 단일 원천으로 둔다 (Provider Registry와 같은 결).
 *
 * 심각도:
 * - `error`: 이대로 운영에 올리면 **동작하지 않거나 위험하다** — 기동 차단
 * - `warning`: 동작은 하지만 운영 기준에 못 미친다 — 기동은 하되 경고
 */

export type EnvSeverity = "error" | "warning";

export type EnvCategory =
  | "core"
  | "database"
  | "storage"
  | "auth"
  | "llm"
  | "ops";

export interface EnvSpec {
  name: string;
  category: EnvCategory;
  /** 무엇에 쓰이는 값인지 (한 줄) */
  description: string;
  /** 운영에서 반드시 있어야 하는가 */
  requiredInProduction?: boolean;
  /** 값 형식 검사 — 문제가 있으면 사유를 돌려준다 */
  validate?: (value: string) => string | null;
  /** 미설정 시의 기본 동작 설명 */
  fallback?: string;
  /** 값이 비밀인가 (검증 결과에 값을 노출하지 않는다) */
  secret?: boolean;
  /**
   * 운영에서 이 값이 특정 상태여야 한다는 권고 —
   * 충족하지 못하면 warning으로 알린다.
   */
  productionAdvice?: (value: string | undefined) => string | null;
}

const positiveNumber = (label: string) => (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? null
    : `${label}은(는) 0보다 큰 숫자여야 합니다 (받은 값: ${value}).`;
};

const oneOf = (allowed: string[]) => (value: string) =>
  allowed.includes(value)
    ? null
    : `허용되지 않는 값입니다: ${value} (${allowed.join(" / ")}).`;

const urlLike = (value: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? null
    : `URL 형식이어야 합니다 (받은 값: ${value}).`;

/**
 * 환경변수 선언 목록.
 * 새 설정을 추가할 때 여기에 등록하면 검증·대시보드·체크리스트에 자동 반영된다.
 */
export const ENV_SPECS: EnvSpec[] = [
  {
    name: "NODE_ENV",
    category: "core",
    description: "실행 환경 — production이면 운영 보호 정책이 켜진다",
    validate: oneOf(["development", "test", "staging", "production"]),
    fallback: "development로 간주",
  },
  {
    name: "PORT",
    category: "core",
    description: "API 수신 포트",
    validate: positiveNumber("PORT"),
    fallback: "4000",
  },
  {
    name: "WEB_URL",
    category: "core",
    description: "CORS 허용 출처 (웹 앱 주소)",
    requiredInProduction: true,
    validate: urlLike,
    fallback: "http://localhost:3000",
    productionAdvice: (value) =>
      value && value.includes("localhost")
        ? "운영 환경인데 WEB_URL이 localhost입니다 — 실제 도메인으로 설정하세요."
        : null,
  },
  {
    name: "DATABASE_URL",
    category: "database",
    description: "PostgreSQL 연결 문자열",
    requiredInProduction: true,
    secret: true,
    validate: (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://")
        ? null
        : "postgresql:// 형식이어야 합니다.",
  },
  {
    name: "S3_ENDPOINT",
    category: "storage",
    description: "이미지 저장소(S3 호환) 엔드포인트",
    requiredInProduction: true,
    validate: urlLike,
  },
  {
    name: "S3_BUCKET",
    category: "storage",
    description: "이미지 버킷 이름",
    requiredInProduction: true,
  },
  {
    name: "S3_ACCESS_KEY",
    category: "storage",
    description: "저장소 액세스 키",
    requiredInProduction: true,
    secret: true,
  },
  {
    name: "S3_SECRET_KEY",
    category: "storage",
    description: "저장소 시크릿 키",
    requiredInProduction: true,
    secret: true,
  },
  {
    name: "AUTH_ADMIN_EMAIL",
    category: "auth",
    description: "초기 관리자 계정 이메일 (부트스트랩)",
    requiredInProduction: true,
  },
  {
    name: "AUTH_ADMIN_PASSWORD",
    category: "auth",
    description: "초기 관리자 비밀번호 (부트스트랩 후 변경 권장)",
    requiredInProduction: true,
    secret: true,
    productionAdvice: (value) =>
      value && value.length < 12
        ? "운영 관리자 비밀번호가 12자 미만입니다 — 더 긴 값을 권장합니다."
        : null,
  },
  {
    name: "AUTH_COOKIE_SECURE",
    category: "auth",
    description: "세션 쿠키 Secure 속성 (HTTPS 전용)",
    validate: oneOf(["0", "1", "true", "false"]),
    fallback: "운영에서는 자동 활성",
    productionAdvice: (value) =>
      value === "0" || value === "false"
        ? "운영에서 AUTH_COOKIE_SECURE가 꺼져 있습니다 — 세션 쿠키가 평문 전송될 수 있습니다."
        : null,
  },
  {
    name: "AUTH_COOKIE_ONLY",
    category: "auth",
    description: "쿠키 전용 모드 — 응답 본문에 토큰을 싣지 않는다 (0804)",
    validate: oneOf(["0", "1", "true", "false"]),
    fallback: "운영/스테이징 기본 활성",
  },
  {
    name: "AUTH_SESSION_TTL_HOURS",
    category: "auth",
    description: "세션 절대 수명(시간)",
    validate: positiveNumber("AUTH_SESSION_TTL_HOURS"),
    fallback: "168 (7일)",
  },
  {
    name: "LLM_PROVIDER",
    category: "llm",
    description: "기본 LLM Provider",
    validate: oneOf(["mock", "openai", "anthropic", "gemini"]),
    fallback: "mock (실제 호출 없음)",
    productionAdvice: (value) =>
      !value || value === "mock"
        ? "운영 환경인데 LLM_PROVIDER가 mock입니다 — 실제 Provider를 지정하세요."
        : null,
  },
  {
    name: "OPENAI_API_KEY",
    category: "llm",
    description: "OpenAI API 키 (openai 사용 시)",
    secret: true,
  },
  {
    name: "ANTHROPIC_API_KEY",
    category: "llm",
    description: "Anthropic API 키 (anthropic 사용 시)",
    secret: true,
  },
  {
    name: "GEMINI_API_KEY",
    category: "llm",
    description: "Google Gemini API 키 (gemini 사용 시)",
    secret: true,
  },
  {
    name: "LLM_DAILY_BUDGET_USD",
    category: "llm",
    description: "일 비용 예산(USD) — 초과 시 호출 차단",
    validate: positiveNumber("LLM_DAILY_BUDGET_USD"),
    fallback: "무제한",
    productionAdvice: (value) =>
      value
        ? null
        : "운영 일 예산이 설정되지 않았습니다 — 비용 폭주를 막을 상한이 없습니다.",
  },
  {
    name: "LLM_MONTHLY_BUDGET_USD",
    category: "llm",
    description: "월 비용 예산(USD)",
    validate: positiveNumber("LLM_MONTHLY_BUDGET_USD"),
    fallback: "무제한",
  },
  {
    name: "LLM_TIMEOUT_MS",
    category: "llm",
    description: "Provider 1회 호출 제한 시간(ms)",
    validate: (value) =>
      Number.isFinite(Number(value)) && Number(value) >= 0
        ? null
        : `0 이상의 숫자여야 합니다 (받은 값: ${value}).`,
    fallback: "120000",
  },
  {
    name: "LLM_FAILOVER_PRIORITY",
    category: "llm",
    description: "Failover 우선순위 (쉼표 구분) — 미설정이면 Failover 비활성",
    fallback: "Failover 없음",
    productionAdvice: (value) =>
      value
        ? null
        : "Failover 우선순위가 없습니다 — 단일 Provider 장애가 곧 서비스 중단입니다.",
  },
  {
    name: "ADMIN_SETTINGS_TTL_MS",
    category: "ops",
    description: "콘솔 설정 캐시 수명(ms) — 다중 인스턴스 전파 지연",
    validate: positiveNumber("ADMIN_SETTINGS_TTL_MS"),
    fallback: "10000",
  },
];

export interface EnvIssue {
  name: string;
  severity: EnvSeverity;
  message: string;
  category: EnvCategory;
}

export interface EnvValidationResult {
  /** error가 하나도 없으면 true */
  ok: boolean;
  production: boolean;
  errors: EnvIssue[];
  warnings: EnvIssue[];
  /** 검사한 항목 수 */
  checked: number;
}

/** 값이 실제로 설정되었는지 (빈 문자열은 미설정으로 본다) */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * 환경 검증. 운영(`production`)에서는 필수 항목 누락을 error로 올리고,
 * 개발에서는 같은 항목을 알리지 않는다 — 개발자가 mock으로 돌리는 것이 정상이다.
 */
export function validateEnvironment(
  env: Record<string, string | undefined>,
  options: { production?: boolean; specs?: EnvSpec[] } = {},
): EnvValidationResult {
  const specs = options.specs ?? ENV_SPECS;
  const production =
    options.production ?? env.NODE_ENV === "production";
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];

  for (const spec of specs) {
    const value = env[spec.name];
    const issue = (severity: EnvSeverity, message: string): EnvIssue => ({
      name: spec.name,
      severity,
      message,
      category: spec.category,
    });

    if (!isSet(value)) {
      if (production && spec.requiredInProduction) {
        errors.push(
          issue(
            "error",
            `필수 환경변수가 없습니다 — ${spec.description}.`,
          ),
        );
        continue;
      }
      // 미설정이어도 운영 권고는 알린다 (예산 미설정 등)
      const advice = production ? spec.productionAdvice?.(undefined) : null;
      if (advice) {
        warnings.push(issue("warning", advice));
      }
      continue;
    }

    const invalid = spec.validate?.(value);
    if (invalid) {
      // 형식 오류는 환경과 무관하게 오류다 — 잘못된 값은 어디서도 동작하지 않는다
      errors.push(issue("error", invalid));
      continue;
    }

    const advice = production ? spec.productionAdvice?.(value) : null;
    if (advice) {
      warnings.push(issue("warning", advice));
    }
  }

  return {
    ok: errors.length === 0,
    production,
    errors,
    warnings,
    checked: specs.length,
  };
}

export interface EnvSpecView {
  name: string;
  category: EnvCategory;
  description: string;
  requiredInProduction: boolean;
  /** 값이 설정되어 있는지 (비밀 값은 이 여부만 노출) */
  configured: boolean;
  /** 비밀이 아닌 값의 실제 값 */
  value: string | null;
  secret: boolean;
  fallback: string | null;
}

/**
 * 설정 현황 표 (Configuration Verification).
 * **비밀 값은 설정 여부만** 돌려준다 — 화면·로그에 키가 새지 않게.
 */
export function describeEnvironment(
  env: Record<string, string | undefined>,
  specs: EnvSpec[] = ENV_SPECS,
): EnvSpecView[] {
  return specs.map((spec) => {
    const value = env[spec.name];
    const configured = isSet(value);
    return {
      name: spec.name,
      category: spec.category,
      description: spec.description,
      requiredInProduction: spec.requiredInProduction ?? false,
      configured,
      value: configured && !spec.secret ? value : null,
      secret: spec.secret ?? false,
      fallback: spec.fallback ?? null,
    };
  });
}

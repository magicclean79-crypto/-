import { providerKeyRequired, validateApiKeyFormat } from "../llm/api-key";

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
  /**
   * 조건부 운영 필수 (CTO 결정 1202-②) — 설정에 따라 필수 여부가 갈릴 때.
   * 예: Provider API 키는 **그 Provider를 실제로 쓸 때만** 필수다.
   */
  requiredWhen?: (env: Record<string, string | undefined>) => boolean;
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

/** 0 초과 1 이하의 비율 (성공률 기준 등) */
const ratio = (label: string) => (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1
    ? null
    : `${label}은(는) 0 초과 1 이하의 비율이어야 합니다 (받은 값: ${value}).`;
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
  // Provider 키는 **그 Provider를 실제로 쓸 때만** 운영 필수다 (CTO 결정 1202-②).
  // 라우팅·Failover·실험 어디서든 참조하면 키가 없을 때 그 경로가 실패한다.
  {
    name: "OPENAI_API_KEY",
    category: "llm",
    description: "OpenAI API 키 (openai를 사용하는 설정이면 필수)",
    secret: true,
    requiredWhen: (env) => providerKeyRequired("openai", env),
    validate: (value) => {
      const result = validateApiKeyFormat("openai", value);
      return result.status === "ok" || result.status === "missing"
        ? null
        : `API 키 형식 문제 — ${result.message}`;
    },
  },
  {
    name: "ANTHROPIC_API_KEY",
    category: "llm",
    description: "Anthropic API 키 (anthropic을 사용하는 설정이면 필수)",
    secret: true,
    requiredWhen: (env) => providerKeyRequired("anthropic", env),
    validate: (value) => {
      const result = validateApiKeyFormat("anthropic", value);
      return result.status === "ok" || result.status === "missing"
        ? null
        : `API 키 형식 문제 — ${result.message}`;
    },
  },
  {
    name: "GEMINI_API_KEY",
    category: "llm",
    description: "Google Gemini API 키 (gemini를 사용하는 설정이면 필수)",
    secret: true,
    requiredWhen: (env) => providerKeyRequired("gemini", env),
    validate: (value) => {
      const result = validateApiKeyFormat("gemini", value);
      return result.status === "ok" || result.status === "missing"
        ? null
        : `API 키 형식 문제 — ${result.message}`;
    },
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
  // ── 모니터링 기준 (TASK-1302, CTO 결정 1301-②) ──
  {
    name: "LLM_MONITOR_HEALTHY_RATE",
    category: "ops",
    description: "정상 판정 성공률 하한 (0~1)",
    validate: ratio("LLM_MONITOR_HEALTHY_RATE"),
    fallback: "0.95 (확정 기본값)",
  },
  {
    name: "LLM_MONITOR_DEGRADED_RATE",
    category: "ops",
    description: "저하 판정 성공률 하한 (0~1) — 이보다 낮으면 장애",
    validate: ratio("LLM_MONITOR_DEGRADED_RATE"),
    fallback: "0.5 (확정 기본값)",
  },
  {
    name: "LLM_MONITOR_MIN_SAMPLES",
    category: "ops",
    description: "상태를 판정하기 위한 최소 호출 수",
    validate: positiveNumber("LLM_MONITOR_MIN_SAMPLES"),
    fallback: "5 (확정 기본값 — 미만이면 판정 보류)",
  },
  {
    name: "LLM_MONITOR_P95_WARN_MS",
    category: "ops",
    description: "p95 지연 경고 기준(ms)",
    validate: positiveNumber("LLM_MONITOR_P95_WARN_MS"),
    fallback: "20000 (확정 기본값)",
  },
  // ── 예약 점검·경보 (TASK-1302) ──
  {
    name: "OPS_SCHEDULED_CHECKS",
    category: "ops",
    description: "예약 점검 전체 스위치 — off면 전부 중단",
    fallback: "켜짐 (비용 검증·설정 검증·Health Check)",
    productionAdvice: (value) =>
      value && ["off", "false", "0"].includes(value.trim().toLowerCase())
        ? "예약 점검이 꺼져 있습니다 — 예산 초과·Provider 장애를 자동으로 알 수 없습니다."
        : null,
  },
  {
    name: "OPS_CHECK_COST_INTERVAL",
    category: "ops",
    description: "비용 검증 점검 간격 (15m·1h·900000 등, off로 중단)",
    fallback: "15m",
  },
  {
    name: "OPS_CHECK_CONFIG_INTERVAL",
    category: "ops",
    description: "설정·Provider 키 검증 점검 간격 (off로 중단)",
    fallback: "15m",
  },
  {
    name: "OPS_CHECK_HEALTH_INTERVAL",
    category: "ops",
    description: "운영 상태 점검 간격 (off로 중단)",
    fallback: "1h",
  },
  {
    name: "ALERT_WEBHOOK_URL",
    category: "ops",
    description: "경보 전달 웹훅 주소 — 미설정이면 로그로만 남는다",
    secret: true,
    validate: (value) =>
      /^https?:\/\//.test(value)
        ? null
        : "http(s) URL이어야 합니다.",
    fallback: "로그만 (사람이 보고 있어야 알 수 있음)",
    productionAdvice: (value) =>
      value
        ? null
        : "경보 전달 채널이 없습니다 — 경보가 로그에만 남아 아무도 모를 수 있습니다.",
  },
  {
    name: "ALERT_COOLDOWN_MS",
    category: "ops",
    description:
      "같은 경보 재알림 간격(ms) — 짧으면 사람이 경보를 무시하게 된다. " +
      "종류별로는 ALERT_COOLDOWN_BUDGET/PROVIDER/UNPRICED/CONFIG_MS",
    validate: positiveNumber("ALERT_COOLDOWN_MS"),
    fallback: "1800000 (30분, 공식 표준)",
  },
  // ── 운영 플랫폼 (TASK-1401) ──
  {
    name: "REDIS_URL",
    category: "ops",
    description: "분산 잠금·리더 선출용 Redis 주소 — 없으면 단일 인스턴스 모드",
    secret: true,
    validate: (value) =>
      /^rediss?:\/\//.test(value) ? null : "redis:// 또는 rediss:// 주소여야 합니다.",
    fallback: "단일 인스턴스 모드 (다중 인스턴스면 점검이 중복 실행됨)",
    productionAdvice: (value) =>
      value
        ? null
        : "분산 잠금이 없습니다 — 인스턴스를 여러 개 띄우면 예약 점검이 중복 실행됩니다.",
  },
  {
    name: "OPS_LOCK_TTL_MS",
    category: "ops",
    description: "분산 잠금 임차 수명(ms) — 리더가 죽어도 이 시간 뒤 재선출된다",
    validate: positiveNumber("OPS_LOCK_TTL_MS"),
    fallback: "30000 (30초)",
  },
  {
    name: "ALERT_SLACK_WEBHOOK_URL",
    category: "ops",
    description: "Slack Incoming Webhook 주소",
    secret: true,
    validate: (value) =>
      /^https?:\/\//.test(value) ? null : "http(s) URL이어야 합니다.",
    fallback: "Slack 알림 없음",
  },
  {
    name: "SMTP_HOST",
    category: "ops",
    description: "경보 메일 발송 SMTP 호스트 (ALERT_EMAIL_TO와 함께 필요)",
    fallback: "메일 알림 없음",
  },
  {
    name: "ALERT_EMAIL_TO",
    category: "ops",
    description: "경보 메일 수신자",
    secret: true,
    fallback: "메일 알림 없음",
  },
  {
    name: "ALERT_RETRY_MAX_ATTEMPTS",
    category: "ops",
    description: "알림 전송 최대 시도 횟수 (최초 1회 포함)",
    validate: positiveNumber("ALERT_RETRY_MAX_ATTEMPTS"),
    fallback: "4",
  },
  {
    name: "ALERT_ARCHIVE_AFTER_DAYS",
    category: "ops",
    description: "해소된 경보를 보관으로 옮기기까지의 일수 (삭제하지 않는다)",
    validate: positiveNumber("ALERT_ARCHIVE_AFTER_DAYS"),
    fallback: "90 (CTO 결정 1302-④)",
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

    const required =
      (spec.requiredInProduction ?? false) || (spec.requiredWhen?.(env) ?? false);

    if (!isSet(value)) {
      if (production && required) {
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
      requiredInProduction:
        (spec.requiredInProduction ?? false) || (spec.requiredWhen?.(env) ?? false),
      configured,
      value: configured && !spec.secret ? value : null,
      secret: spec.secret ?? false,
      fallback: spec.fallback ?? null,
    };
  });
}

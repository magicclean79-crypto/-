import { providerKeyRequired, validateApiKeyFormat } from "../llm/api-key";
import { judgeRestoreTarget } from "./enterprise-recovery";

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
  productionAdvice?: (
    value: string | undefined,
    env?: Record<string, string | undefined>,
  ) => string | null;
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
    description:
      "이미지 저장소 엔드포인트 — 운영 표준은 Amazon S3다 (CTO 결정 1801-④)",
    requiredInProduction: true,
    validate: urlLike,
    // MinIO·s3rver는 개발 전용이다. 버전 관리·복제 조회를 지원하지 않아
    // 운영에서 쓰면 보호 상태를 영영 "직접 확인"으로만 볼 수 있다.
    productionAdvice: (value) => {
      if (!value) {
        return null;
      }
      let host: string;
      try {
        host = new URL(value).hostname.toLowerCase();
      } catch {
        return null;
      }
      if (host.endsWith("amazonaws.com")) {
        return null;
      }
      return (
        `운영 저장소 표준은 Amazon S3입니다 (CTO 결정 1801-④) — 지금 값은 ${host}입니다. ` +
        "MinIO·s3rver는 개발 전용이며, 버전 관리·복제 조회를 지원하지 않아 " +
        "보호 상태를 자동으로 확인할 수 없습니다."
      );
    },
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
  // ── OCR·Vision 엔진 (TASK-2901, CTO 결정 2801-⑤) ─────────
  // 그전에는 OCR 엔진 선택이 **어느 화면에도 없었다** — 운영에서 가짜 OCR이
  // 돌고 있어도 아무도 알 수 없었다.
  {
    name: "OCR_PROVIDER",
    category: "llm",
    description:
      "OCR 엔진 (mock · tesseract(개발용) · google-vision(운영 표준))",
    validate: oneOf(["mock", "tesseract", "google-vision"]),
    fallback: "mock (이미지에서 글자를 읽지 않고 가짜 텍스트를 만든다)",
    productionAdvice: (value) => {
      const name = (value ?? "mock").trim().toLowerCase();
      if (name === "mock") {
        return "운영 환경인데 OCR_PROVIDER가 mock입니다 — 가짜 텍스트로 조립된 상품은 사실이 아닙니다. google-vision을 붙이세요.";
      }
      if (name === "tesseract") {
        return "tesseract는 개발용 선택 엔진입니다 (CTO 결정 2401-⑤) — 운영 표준은 google-vision입니다.";
      }
      return null;
    },
  },
  {
    name: "GOOGLE_VISION_API_KEY",
    category: "llm",
    description: "Google Cloud Vision API 키 (OCR_PROVIDER=google-vision이면 필수)",
    secret: true,
    requiredWhen: (env) =>
      (env.OCR_PROVIDER ?? "").trim().toLowerCase() === "google-vision",
    validate: (value) => {
      const result = validateApiKeyFormat("google-vision", value);
      return result.status === "ok" || result.status === "missing"
        ? null
        : `API 키 형식 문제 — ${result.message}`;
    },
  },
  {
    name: "GOOGLE_VISION_ENDPOINT",
    category: "llm",
    description:
      "Google Cloud Vision 엔드포인트 (스테이징 프록시·계약 검증용 — 평소에는 지정하지 않는다). 공식 주소가 아니면 그 성공 기록을 운영 연결의 증거로 세지 않는다 (TASK-3401)",
    validate: urlLike,
    fallback: "https://vision.googleapis.com/v1/images:annotate",
    // 키는 쿼리에 실려 나간다 — 엔드포인트를 바꿔 두면 키가 그곳으로 간다
    productionAdvice: (value) =>
      value && !value.startsWith("https://vision.googleapis.com/")
        ? "운영에서 GOOGLE_VISION_ENDPOINT가 공식 주소가 아닙니다 — API 키가 그 주소로 전송됩니다. 의도한 프록시인지 확인하세요."
        : null,
  },
  {
    name: "OCR_LANGUAGE_HINTS",
    category: "llm",
    description: "google-vision 언어 힌트 (쉼표 구분, 예: ko,en)",
    fallback: "ko,en",
  },
  {
    name: "VISION_PROVIDER",
    category: "llm",
    description:
      "[사용 안 함] Vision은 별도 엔진이 아니라 LLM Gateway를 탑니다 — LLM_PROVIDER를 쓰세요",
    fallback: "무시됨",
    // 값이 남아 있으면 운영자는 그 엔진이 쓰인다고 믿는다 — 조용히 무시하면 안 된다
    productionAdvice: (value) =>
      value
        ? "VISION_PROVIDER는 더 이상 읽지 않습니다 — Vision은 LLM_PROVIDER와 LLM_MODEL_VISION을 따릅니다 (TASK-0505)."
        : null,
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
    // 가격 변경 감지 (TASK-3201, CTO 정책 3201-①)
    name: "OPS_CHECK_PRICING_DETECT_INTERVAL",
    category: "ops",
    description:
      "가격 변경 감지 간격 (기록과 가격표를 대조 — off로 중단). 감지는 제안까지만 만들고 적용은 사람이 한다",
    fallback: "6h",
  },
  {
    // 월말 비용 예측 경보 (TASK-3201, CTO 정책 3201-④)
    name: "OPS_CHECK_FORECAST_AT",
    category: "ops",
    description:
      "월말 비용 예측 경보 실행 시각 HH:MM (운영 서버 로컬 시각) — off로 중단. 경보만 내고 호출은 막지 않는다",
    fallback: "06:00 로컬",
  },
  {
    // 외부 가격 공지 (TASK-3301, CTO 정책 3301-①)
    name: "PRICE_SOURCE_URL",
    category: "ops",
    description:
      "가격 공지 주소 (JSON) — 미설정은 실패가 아니지만, 공지 대조 없이는 Provider 단가 변경을 우리 기록만으로 알 수 없다",
    validate: (value) =>
      /^https?:\/\//.test(value)
        ? null
        : "http(s) 주소여야 합니다 (예: https://provider.example/pricing.json)",
  },
  {
    name: "PRICE_SOURCE_TOKEN",
    category: "ops",
    description: "가격 공지 인증 토큰 — 헤더로만 보내며 기록에 남기지 않는다",
    secret: true,
  },
  {
    name: "PRICE_SOURCE_TIMEOUT_MS",
    category: "ops",
    description:
      "가격 공지 조회 제한 시간 — 지나면 '못 읽음'으로 판정한다 (변경 없음이 아니다)",
    validate: positiveNumber("PRICE_SOURCE_TIMEOUT_MS"),
    fallback: "5000",
  },
  {
    // Provider별 공지 (TASK-3401, CTO 결정 3301-⑤)
    name: "PRICE_SOURCE_URL_<PROVIDER>",
    category: "ops",
    description:
      "Provider별 가격 공지 주소 (예: PRICE_SOURCE_URL_OPENAI). 소스마다 따로 읽고 따로 판정한다 — 한 곳이 죽어도 나머지는 읽힌다. 프로젝트별 설정은 거부한다",
  },
  {
    name: "PRICE_SOURCE_FORMAT_<PROVIDER>",
    category: "ops",
    description:
      "공지 본문 형식 (acos | flat). 모르는 값이면 그 소스를 읽지 않고 사유를 남긴다 — 짐작으로 읽은 단가는 못 읽은 단가보다 위험하다",
    fallback: "acos",
  },
  {
    name: "PRICE_SOURCE_TOKEN_<PROVIDER>",
    category: "ops",
    description:
      "Provider별 공지 인증 토큰 — 그 소스에만 보내며 기록에 남기지 않는다",
    secret: true,
  },
  {
    // 실패 장기화 승격 (TASK-3401, CTO 결정 3301-⑥)
    name: "PRICE_SOURCE_ESCALATE_AFTER_MS",
    category: "ops",
    description:
      "같은 공지를 이 시간 넘게 못 읽으면 경보를 critical로 올린다. 미구성은 승격하지 않는다 — 미구성과 실패는 다르다",
    validate: positiveNumber("PRICE_SOURCE_ESCALATE_AFTER_MS"),
    fallback: "24시간",
  },
  {
    // 감지 주기 (TASK-3301, CTO 정책 3301-④)
    name: "PRICE_DETECT_INTERVAL_<PROVIDER>",
    category: "ops",
    description:
      "Provider별 가격 감지 주기 (예: PRICE_DETECT_INTERVAL_GOOGLE_VISION=12h). 프로젝트별 설정은 지원하지 않는다 — 단가는 Provider와의 계약이다",
    fallback: "6h",
  },
  {
    // 운영 전환 검증 (TASK-3401, CTO 지시 4·6)
    name: "GITHUB_REPOSITORY",
    category: "ops",
    description:
      "GitHub Actions 실행 이력을 읽을 저장소 (owner/repo) — 미설정이면 CI 상태를 '모름'으로 둔다(통과로 세지 않는다)",
  },
  {
    name: "GITHUB_TOKEN",
    category: "ops",
    description:
      "GitHub API 토큰 — 비공개 저장소의 실행 이력 조회에만 쓰며 기록에 남기지 않는다",
    secret: true,
  },
  {
    name: "CI_WORKFLOW_PATH",
    category: "ops",
    description:
      "CI 워크플로 파일 경로 — 못 읽으면 게이트가 있다고 가정하지 않는다",
    fallback: ".github/workflows/ci.yml",
  },
  {
    name: "OPENAI_BASE_URL",
    category: "llm",
    description:
      "OpenAI SDK가 읽는 주소 재정의 — 우리 코드는 읽지 않지만 SDK는 읽는다. 공식이 아니면 운영 전환으로 세지 않는다 (TASK-3401)",
  },
  {
    name: "ANTHROPIC_BASE_URL",
    category: "llm",
    description:
      "Anthropic SDK가 읽는 주소 재정의 — 공식이 아니면 운영 전환으로 세지 않는다 (TASK-3401)",
  },
  {
    name: "ALERT_COOLDOWN_PRICE_SOURCE_MS",
    category: "ops",
    description:
      "가격 공지 실패 재알림 간격 — 사람이 고칠 때까지 이어지는 상태다",
    validate: positiveNumber("ALERT_COOLDOWN_PRICE_SOURCE_MS"),
    fallback: "ALERT_COOLDOWN_MS 또는 30분",
  },
  {
    name: "ALERT_COOLDOWN_PRICING_DRIFT_MS",
    category: "ops",
    description:
      "단가 변경 감지 재알림 간격 — 사람이 승인해야 사라지므로 30분마다 부르면 소음이 된다",
    validate: positiveNumber("ALERT_COOLDOWN_PRICING_DRIFT_MS"),
    fallback: "ALERT_COOLDOWN_MS 또는 30분",
  },
  {
    name: "ALERT_COOLDOWN_FORECAST_MS",
    category: "ops",
    description:
      "월말 예측 경보 재알림 간격 — 하루 단위 사안이므로 86400000 권장",
    validate: positiveNumber("ALERT_COOLDOWN_FORECAST_MS"),
    fallback: "ALERT_COOLDOWN_MS 또는 30분",
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
  // ── 고가용·운영 신뢰성 (TASK-1501) ──
  {
    name: "OPS_CHECK_ARCHIVE_AT",
    category: "ops",
    description: "경보·Dead Letter 보관 실행 시각 HH:MM (운영 서버 로컬 시각) — off로 중단",
    fallback: "04:00 로컬 (CTO 결정 1501-①)",
  },
  {
    name: "OPS_SCHEDULER_WATCHDOG",
    category: "ops",
    description: "예약 점검 정지 감시 — off면 멈춰도 알리지 않는다",
    fallback: "켜짐 (CTO 결정 1401-①)",
    productionAdvice: (value) =>
      value && ["off", "false", "0"].includes(value.trim().toLowerCase())
        ? "예약 점검 정지 감시가 꺼져 있습니다 — 점검이 멈춰도 아무도 모릅니다."
        : null,
  },
  {
    name: "OPS_SCHEDULER_GRACE_FACTOR",
    category: "ops",
    description: "정지 판정 여유 배수 — 간격의 N배를 넘겨야 멈춘 것으로 본다",
    validate: positiveNumber("OPS_SCHEDULER_GRACE_FACTOR"),
    fallback: "3",
  },
  {
    name: "ALERT_QUEUE_WORKER",
    category: "ops",
    description: "알림 Retry Worker — off면 큐에 쌓인 알림이 나가지 않는다",
    fallback: "켜짐 (CTO 결정 1401-②)",
    productionAdvice: (value) =>
      value && ["off", "false", "0"].includes(value.trim().toLowerCase())
        ? "알림 Retry Worker가 꺼져 있습니다 — 경보가 큐에만 쌓입니다."
        : null,
  },
  {
    name: "ALERT_QUEUE_INTERVAL_MS",
    category: "ops",
    description: "알림 큐 처리 주기(ms)",
    validate: positiveNumber("ALERT_QUEUE_INTERVAL_MS"),
    fallback: "10000 (10초)",
  },
  {
    name: "ALERT_SLACK_MIN_LEVEL",
    category: "ops",
    description: "Slack 최소 심각도 (warning | critical)",
    validate: oneOf(["warning", "critical"]),
    fallback: "warning (CTO 결정 1401-④)",
  },
  {
    name: "ALERT_EMAIL_MIN_LEVEL",
    category: "ops",
    description: "Email 최소 심각도 (warning | critical)",
    validate: oneOf(["warning", "critical"]),
    fallback: "critical (CTO 결정 1401-④ — 메일은 쌓이면 안 읽는다)",
  },
  {
    name: "ALERT_WEBHOOK_MIN_LEVEL",
    category: "ops",
    description: "Webhook 최소 심각도 (warning | critical)",
    validate: oneOf(["warning", "critical"]),
    fallback: "warning (CTO 결정 1401-④)",
  },
  // ── 운영 검증·재해 복구 (TASK-1601) ──
  {
    name: "TZ",
    category: "ops",
    description:
      "예약 점검의 기준 시간대 — 일 1회 점검은 이 시간대의 시각으로 돈다 (CTO 결정 1501-①)",
    fallback: "컨테이너 기본 시간대 (대개 UTC)",
    productionAdvice: (value) =>
      value
        ? null
        : "TZ가 지정되지 않았습니다 — 새벽 백업·보관이 운영자가 생각하는 시각과 다르게 돌 수 있습니다.",
  },
  {
    name: "BACKUP_DIR",
    category: "ops",
    description:
      "데이터베이스 백업 파일을 두는 디렉터리 — 컨테이너 밖 볼륨을 가리켜야 한다",
    // CTO 결정 1601-①: 운영 필수로 승격. 미설정이면 기동하지 않는다 —
    // 백업이 컨테이너와 함께 사라지는 구성으로 운영을 시작할 수는 없다
    requiredInProduction: true,
    fallback: "/var/backups/acos (개발 전용)",
  },
  {
    name: "BACKUP_RETENTION_DAYS",
    category: "ops",
    description: "백업 보관 일수 — 지난 파일은 정리한다",
    validate: positiveNumber("BACKUP_RETENTION_DAYS"),
    fallback: "14",
  },
  {
    name: "BACKUP_KEEP_MINIMUM",
    category: "ops",
    description:
      "보관 기간이 지나도 남겨 둘 최소 백업 개수 — 정리가 마지막 백업까지 지우지 않도록",
    validate: positiveNumber("BACKUP_KEEP_MINIMUM"),
    fallback: "3",
  },
  {
    name: "BACKUP_TIMEOUT_MS",
    category: "ops",
    description: "pg_dump·pg_restore 1회 제한 시간(ms)",
    validate: positiveNumber("BACKUP_TIMEOUT_MS"),
    fallback: "600000 (10분)",
  },
  {
    name: "BACKUP_RESTORE_DB_URL",
    category: "ops",
    description:
      "복원 검증 전용 데이터베이스 — 운영 DB를 절대 지정하지 마십시오 (덮어씁니다)",
    secret: true,
    validate: (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://")
        ? null
        : "postgresql:// 형식이어야 합니다.",
    fallback: "복원 검증 미구성 (백업이 복원되는지 확인하지 못한다)",
    productionAdvice: (value) =>
      value
        ? null
        : "복원 검증 대상 DB가 없습니다 — 복원해 보지 않은 백업은 백업이 아닙니다.",
  },
  {
    name: "OPS_CHECK_BACKUP_INTERVAL",
    category: "ops",
    description: "백업 실행 간격 (15m · 1h 등) — off로 중단",
    fallback: "1h (CTO 결정 1701-①)",
  },
  {
    name: "OPS_CHECK_BACKUP_AT",
    category: "ops",
    description:
      "[사용 안 함] 백업은 시각이 아니라 간격으로 돕니다 — OPS_CHECK_BACKUP_INTERVAL을 쓰세요",
    fallback: "무시됨",
    // 값이 남아 있으면 운영자는 그 시각에 돈다고 믿는다 — 조용히 무시하면 안 된다
    productionAdvice: (value) =>
      value
        ? "OPS_CHECK_BACKUP_AT은 더 이상 쓰이지 않습니다 — 백업은 OPS_CHECK_BACKUP_INTERVAL 간격으로 돕니다 (CTO 결정 1701-①)."
        : null,
  },
  {
    name: "OPS_CHECK_RESTORE_AT",
    category: "ops",
    description: "복원 검증 실행 시각 HH:MM (운영 서버 로컬 시각) — off로 중단",
    fallback: "03:30 로컬",
  },
  {
    name: "OPS_CHECK_SMOKE_AT",
    category: "ops",
    description:
      "Provider Smoke 실행 시각 HH:MM — 실제 과금되므로 기본은 꺼져 있다",
    fallback: "꺼짐 (켜려면 시각을 지정, CTO 결정 1301-①)",
  },
  {
    name: "OPS_LOCK_OUTAGE_THRESHOLD_MS",
    category: "ops",
    description:
      "Redis 장애가 이 시간 이상 이어지면 Critical 경보를 반복한다 (CTO 결정 1501-②)",
    validate: positiveNumber("OPS_LOCK_OUTAGE_THRESHOLD_MS"),
    fallback: "1800000 (30분)",
  },
  {
    name: "OPS_TICK_INTERVAL_MS",
    category: "ops",
    description: "예약 점검 스케줄러가 할 일을 둘러보는 주기(ms)",
    validate: positiveNumber("OPS_TICK_INTERVAL_MS"),
    fallback: "60000 (1분)",
  },
  // ── Enterprise 백업·재해 복구 (TASK-1701) ──
  {
    name: "BACKUP_OFFSITE",
    category: "ops",
    description:
      "백업 덤프를 오브젝트 저장소에도 올린다 (on | off) — 호스트가 사라져도 백업은 남는다",
    validate: oneOf(["on", "off", "1", "0", "true", "false"]),
    fallback: "off (백업이 데이터베이스와 같은 곳에만 남는다)",
    productionAdvice: (value) =>
      ["on", "1", "true"].includes((value ?? "").toLowerCase())
        ? null
        : "백업 원격 복제가 꺼져 있습니다 — 호스트가 사라지면 백업도 함께 사라집니다.",
  },
  {
    name: "BACKUP_BUCKET",
    category: "ops",
    description:
      "백업 전용 버킷 — 이미지 버킷과 분리해야 한 쪽이 사라져도 다른 쪽이 남는다",
    fallback: "S3_BUCKET + '-backups'",
    productionAdvice: (value, env) =>
      value && env?.S3_BUCKET && value.trim() === env.S3_BUCKET.trim()
        ? "백업 버킷이 이미지 버킷과 같습니다 — 그 버킷이 사라지면 이미지와 백업이 함께 사라집니다 (CTO 결정 1701-②)."
        : null,
  },
  {
    name: "BACKUP_OFFSITE_PREFIX",
    category: "ops",
    description: "원격 복제 시 오브젝트 키 접두사",
    fallback: "backups/",
  },
  {
    name: "OPS_DRILL_INTERVAL_DAYS",
    category: "ops",
    description:
      "복구 리허설 주기(일) — 분기 1회가 운영 표준이다 (CTO 결정 1701-⑤)",
    validate: positiveNumber("OPS_DRILL_INTERVAL_DAYS"),
    fallback: "90",
  },
  {
    name: "OPS_DRILL_GRACE_DAYS",
    category: "ops",
    description: "리허설 기한 초과 후 경보까지의 유예(일)",
    validate: positiveNumber("OPS_DRILL_GRACE_DAYS"),
    fallback: "14",
  },
  {
    name: "BACKUP_RPO_HOURS",
    category: "ops",
    description:
      "허용하는 최대 데이터 손실 구간(시간) — 지금 무너지면 얼마를 잃어도 되는가",
    validate: positiveNumber("BACKUP_RPO_HOURS"),
    fallback: "24 (하루 1회 백업 기준)",
  },
  {
    name: "BACKUP_RTO_MINUTES",
    category: "ops",
    description:
      "복원에 허용하는 시간(분) — 실제 복원 검증 측정치와 비교한다",
    validate: positiveNumber("BACKUP_RTO_MINUTES"),
    fallback: "30",
  },
  {
    name: "BACKUP_MAX_AGE_HOURS",
    category: "ops",
    description: "백업 신선도 한계(시간) — 넘기면 '오래됨'으로 표시한다",
    validate: positiveNumber("BACKUP_MAX_AGE_HOURS"),
    fallback: "48 (2일 — CTO 결정 1601-⑤)",
  },
  {
    name: "RESTORE_MAX_AGE_HOURS",
    category: "ops",
    description: "복원 검증 신선도 한계(시간)",
    validate: positiveNumber("RESTORE_MAX_AGE_HOURS"),
    fallback: "192 (8일 — CTO 결정 1601-⑤)",
  },
  {
    name: "BACKUP_CHAIN_WINDOW_HOURS",
    category: "ops",
    description:
      "백업 사슬을 판정하는 관측 창(시간) — 최소는 백업 간격의 4배이며, 그보다 짧게 두면 자동으로 올립니다",
    // 형식 오류로 기동을 막지 않는다 (CTO 결정 2101-②) — 판정 설정 하나
    // 때문에 서비스가 뜨지 않으면 안 된다. 잘못 적은 값은 Readiness의
    // `chain-window` 항목에 Warning으로 드러난다.
    productionAdvice: (value) =>
      value !== undefined &&
      value.trim().length > 0 &&
      !(Number.isFinite(Number(value)) && Number(value) > 0)
        ? "BACKUP_CHAIN_WINDOW_HOURS 값을 해석할 수 없어 기본값으로 돕니다 — 시간 단위 숫자로 적으세요. 기동은 막지 않습니다 (CTO 결정 2101-②)."
        : null,
    fallback: "24 (CTO 결정 2001-①)",
  },
  {
    name: "OPS_CHECK_REMOTE_VERIFY_INTERVAL",
    category: "ops",
    description:
      "원격 사본 대조 간격 (1h · 7d 등) — 저장소에서 실제로 내려받으므로 전송 비용이 듭니다. 운영이 아니면 기본은 꺼짐입니다",
    fallback: "운영 7일 · 그 외 꺼짐 (CTO 결정 2001-②)",
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
      const advice = production ? spec.productionAdvice?.(undefined, env) : null;
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

    const advice = production ? spec.productionAdvice?.(value, env) : null;
    if (advice) {
      warnings.push(issue("warning", advice));
    }
  }

  // 항목 하나만 봐서는 알 수 없는 검사 (CTO 결정 1601-②).
  // 복원은 대상 스키마를 지우고 쓴다 — 운영 DB를 가리키면 검증이 곧 사고다.
  // 환경과 무관하게 오류다: 개발에서도 운영 DB를 지우는 설정은 허용할 수 없다.
  const target = judgeRestoreTarget(env.DATABASE_URL, env.BACKUP_RESTORE_DB_URL);
  if (target.verdict === "same-as-production") {
    errors.push({
      name: "BACKUP_RESTORE_DB_URL",
      severity: "error",
      message: target.detail,
      category: "ops",
    });
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

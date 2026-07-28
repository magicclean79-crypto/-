/**
 * Provider Registry — Code-first 중앙 정의. (TASK-0902, Sprint 9 —
 * Multi-Provider Foundation)
 *
 * 알려진 LLM Provider의 연결 상태·기본 모델·키 환경변수를 한 곳에 선언한다.
 * (가격표 DEFAULT_LLM_PRICING과 같은 결 — 새 Provider 공식 연결 시 이 표와
 * 어댑터 팩토리만 갱신하면 된다.)
 */

export type LlmProviderConnection =
  /** 공식 연결 완료 — 구조화 출력·멀티모달·비용 산정 활성 */
  | "official"
  /** 어댑터 구현됨 — 구조화 출력 매핑 등 공식 연결 대기 */
  | "adapter-ready"
  /** 개발 기본 — 실제 API 미호출 */
  | "mock";

export interface LlmProviderInfo {
  name: string;
  title: string;
  connection: LlmProviderConnection;
  /** API 키 환경변수 이름 (mock은 null) */
  keyEnv: string | null;
  defaultModel: string;
  /** 가격표 등록 등 대표 모델 목록 */
  models: string[];
  note: string;
}

export const LLM_PROVIDER_REGISTRY: LlmProviderInfo[] = [
  {
    name: "mock",
    title: "Mock",
    connection: "mock",
    keyEnv: null,
    defaultModel: "mock-llm-1",
    models: ["mock-llm-1"],
    note: "개발 기본 — 실제 API 미호출, 비용 0",
  },
  {
    name: "openai",
    title: "OpenAI",
    connection: "official",
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini"],
    note: "공식 연결 (TASK-0603 · Production TASK-0901) — json_object·멀티모달·비용 산정",
  },
  {
    name: "anthropic",
    title: "Anthropic",
    connection: "adapter-ready",
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-opus-5",
    models: ["claude-opus-5"],
    note: "어댑터 구현됨 — 구조화 출력 매핑·가격표는 공식 연결 시",
  },
  {
    name: "gemini",
    title: "Google Gemini",
    connection: "adapter-ready",
    keyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash"],
    note: "어댑터 구현됨 — 구조화 출력 매핑·가격표는 공식 연결 시",
  },
];

/**
 * Model Routing (TASK-0902) — feature별 모델 지정 환경변수.
 * 값이 설정되면 해당 feature의 호출은 그 모델을 사용한다(호출자가 model을
 * 명시하면 호출자 우선). Provider는 LLM_PROVIDER 하나로 유지 — 현 단계
 * 라우팅은 "선택된 Provider 안의 모델 선택"이다 (Foundation 범위).
 */
export const LLM_FEATURE_MODEL_ENV: Record<string, string> = {
  "content-generation": "LLM_MODEL_CONTENT",
  "product-analysis": "LLM_MODEL_ANALYSIS",
  "vision-analysis": "LLM_MODEL_VISION",
};

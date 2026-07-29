export const APP_NAME = "AI Product Content OS";

export type HealthStatus = "OK" | "DEGRADED" | "DOWN";

export const CONTENT_STATUSES = [
  "DRAFT",
  "REVIEW",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export interface ProductDto {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
}

export interface ContentDto {
  id: string;
  projectId: string;
  productObjectId: string | null;
  productObjectVersion: number | null;
  title: string;
  body: string;
  status: ContentStatus;
  /** 발행 시각 (TASK-0703) — PUBLISHED 전이 시 기록 */
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 콘텐츠 상태 전이 요청 (TASK-0703 — 발행 파이프라인) */
export interface UpdateContentStatusRequest {
  status: ContentStatus;
}

/** 발행 파이프라인 감사 이력 (TASK-0704) — 상태 전이 1건당 1레코드 */
export interface ContentStatusHistoryDto {
  id: string;
  contentId: string;
  fromStatus: ContentStatus;
  toStatus: ContentStatus;
  /** 수행자 이메일 (TASK-0801 Actor Audit) — 인증 도입 전 기록은 null */
  actor: string | null;
  createdAt: string;
}

// ── 인증/권한 (TASK-0801, Sprint 8) ────────────────────

/** 역할 계층: ADMIN > EDITOR > VIEWER */
export const USER_ROLES = ["ADMIN", "EDITOR", "VIEWER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** 비활성화 여부 (TASK-0802) — true면 로그인/세션 무효 */
  disabled: boolean;
  /** 잠금 해제 시각 (TASK-0804) — 미래 시각이면 로그인 잠금 상태 */
  lockedUntil: string | null;
  createdAt: string;
}

/** 사용자 수정 요청 (TASK-0802, ADMIN 전용) — role/disabled 부분 수정 */
export interface UpdateUserRequest {
  role?: UserRole;
  disabled?: boolean;
}

export const USER_AUDIT_ACTIONS = [
  "USER_CREATED",
  "ROLE_CHANGED",
  "USER_DISABLED",
  "USER_ENABLED",
  "PASSWORD_CHANGED",
  "PASSWORD_RESET",
  "LOGIN_FAILED",
  "ACCOUNT_LOCKED",
] as const;

export type UserAuditAction = (typeof USER_AUDIT_ACTIONS)[number];

/** 사용자 관리 감사 로그 (TASK-0802) */
export interface UserAuditLogDto {
  id: string;
  actor: string;
  action: UserAuditAction;
  targetEmail: string;
  detail: string | null;
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponseDto {
  /** 세션 토큰 — 쿠키 전용 모드(운영, TASK-0804)에서는 null (httpOnly 쿠키만 발급) */
  token: string | null;
  expiresAt: string;
  user: UserDto;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  password: string;
  role: UserRole;
}

/** 비밀번호 변경 (TASK-0803) — 본인 셀프 서비스, 모든 역할 가능 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** 비밀번호 재설정 (TASK-0803) — ADMIN이 다른 사용자에게 새 비밀번호 지정 */
export interface ResetPasswordRequest {
  newPassword: string;
}

export interface GenerateContentRequest {
  /** 사용할 Product Object 버전. 미지정 시 최신 READY 버전 사용 */
  productObjectVersion?: number;
}

export interface ImageDto {
  id: string;
  key: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  productId?: string | null;
  createdAt: string;
}

export interface UploadImagesResponse {
  images: ImageDto[];
}

// ── Project (최상위 루트 엔티티) ────────────────────────

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string | null;
}

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListItemDto extends ProjectDto {
  productCount: number;
  productObjectCount: number;
}

export interface ProjectDetailDto extends ProjectDto {
  products: ProductListItemDto[];
  latestProductObjectVersion: number | null;
}

export interface CreateProductRequest {
  name?: string;
  description?: string;
  imageIds: string[];
  /** 소속 프로젝트. 미지정 시 상품 이름으로 프로젝트가 자동 생성된다. */
  projectId?: string;
}

export interface UpdateProductRequest {
  name?: string;
  description?: string | null;
}

export interface ProductListItemDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  imageCount: number;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageWithOcrDto extends ImageDto {
  /** 가장 최근 OCR 실행 결과 요약 (실행 이력이 없으면 null) */
  ocr: {
    status: OcrStatus;
    confidence: number | null;
    extractedText: string | null;
  } | null;
}

export interface ProductDetailDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  images: ImageWithOcrDto[];
  createdAt: string;
  updatedAt: string;
}

export const OCR_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
] as const;

export type OcrStatus = (typeof OCR_STATUSES)[number];

export interface OcrResultDto {
  id: string;
  imageId: string;
  provider: string;
  status: OcrStatus;
  extractedText: string | null;
  confidence: number | null; // 0.0 ~ 1.0
  rawJson?: unknown; // Provider 원본 응답 JSON
  error: string | null;
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const UPLOAD_MAX_FILES = 10;
export const UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const UPLOAD_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** AI 분석 실행 상태 — OCR과 동일한 전이 규칙을 사용한다 */
export type AnalysisStatus = OcrStatus;

/** AI 분석이 산출하는 구조화된 상품 정보 */
export interface ProductAnalysis {
  name: string;
  category: string;
  keywords: string[];
  description: string;
  attributes: Record<string, string>;
  confidence: number; // 0.0 ~ 1.0
}

export interface AnalysisResultDto {
  id: string;
  productId: string;
  provider: string;
  status: AnalysisStatus;
  result: ProductAnalysis | null;
  rawJson?: unknown;
  error: string | null;
  attempts: number;
  /** 결과가 상품(name/description)에 반영되었는지 */
  applied: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunAnalysisRequest {
  /** true면 SUCCESS 시 결과를 상품 name/description에 반영한다 (기본 false) */
  apply?: boolean;
}

// ── Product Object ─────────────────────────────────────

export const PRODUCT_OBJECT_STATUSES = [
  "DRAFT",
  "READY",
  "ARCHIVED",
] as const;

export type ProductObjectStatus = (typeof PRODUCT_OBJECT_STATUSES)[number];

/** OCR 결과 요약 — Product Object에 저장되는 형태 */
export interface OcrTextSource {
  imageId: string;
  text: string;
  confidence: number | null;
}

export interface OcrSummary {
  sources: OcrTextSource[];
  combinedText: string;
  averageConfidence: number | null;
}

/** Vision 분석 요약 — 실제 Vision 연동 전까지 mock으로 채워진다 */
export interface VisionSummary {
  source: string; // "mock" | (향후) "claude-vision" 등
  labels: string[];
  brand: string | null;
  category: string | null;
  suggestedTitle: string | null;
  confidence: number; // 0.0 ~ 1.0
}

export interface ProductObjectDto {
  id: string;
  projectId: string;
  version: number;
  status: ProductObjectStatus;
  title: string;
  brand: string | null;
  category: string | null;
  attributes: Record<string, string>;
  ocrSummary: OcrSummary | null;
  visionSummary: VisionSummary | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ── SOP (Standard Operating Procedure) ─────────────────

export const SOP_STEP_STATUSES = [
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "SKIPPED",
] as const;

export type SopStepStatus = (typeof SOP_STEP_STATUSES)[number];

export type SopRunStatus = "RUNNING" | "DONE" | "FAILED";

export interface SopStepResultDto {
  key: string;
  name: string;
  status: SopStepStatus;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SopRunDto {
  id: string;
  projectId: string;
  sopKey: string;
  status: SopRunStatus;
  steps: SopStepResultDto[];
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Decision Log (TASK-0306) ───────────────────────────

/** 결정 유형 — CTO 결정으로 Enum 고정 (자유 문자열 아님) */
export const DECISION_TYPES = [
  "ARCHITECTURE",
  "PROCESS",
  "PRODUCT",
  "BUSINESS",
  "TECHNICAL",
  "QUALITY",
  "SECURITY",
  "OTHER",
] as const;

export type DecisionType = (typeof DECISION_TYPES)[number];

export interface DecisionDto {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  reason: string;
  decisionType: DecisionType;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDecisionRequest {
  title: string;
  description?: string;
  reason: string;
  decisionType: DecisionType;
  author: string;
}

export interface UpdateDecisionRequest {
  title?: string;
  description?: string | null;
  reason?: string;
  decisionType?: DecisionType;
  author?: string;
}

// ── ProjectMemory (구 Memory, TASK-0307 — TASK-0402에서 개칭·보존) ──

export interface ProjectMemoryDto {
  id: string;
  projectId: string;
  title: string;
  content: string;
  /** 기억의 출처 (예: TASK, SOP 실행, 문서 — 선택) */
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectMemoryRequest {
  title: string;
  content: string;
  source?: string;
}

export interface UpdateProjectMemoryRequest {
  title?: string;
  content?: string;
  source?: string | null;
}

// ── Memory — 표준 Structured Memory (TASK-0402, Company Brain) ──

/** Memory 적용 범위 — CTO 결정으로 Enum 고정 */
export const MEMORY_SCOPES = [
  "GLOBAL",
  "COMPANY",
  "PROJECT",
  "PRODUCT",
] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export interface MemoryDto {
  id: string;
  scope: MemoryScope;
  /** 범위 대상 식별자 — PROJECT는 projectId, PRODUCT는 productId. GLOBAL/COMPANY는 null */
  scopeId: string | null;
  key: string;
  /** 구조화 값 — JSON 직렬화 가능한 모든 값 */
  value: unknown;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryRequest {
  scope: MemoryScope;
  scopeId?: string;
  key: string;
  value: unknown;
  description?: string;
}

export interface UpdateMemoryRequest {
  value?: unknown;
  description?: string | null;
}

// ── Knowledge (TASK-0401, Company Brain) ───────────────

/** 지식 분류 — CTO 결정으로 Enum 고정 */
export const KNOWLEDGE_CATEGORIES = [
  "RULE",
  "POLICY",
  "GUIDE",
  "BRAND",
  "LEGAL",
  "QUALITY",
  "FAQ",
  "OTHER",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeDto {
  id: string;
  title: string;
  content: string;
  category: KnowledgeCategory | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeRequest {
  title: string;
  content: string;
  category?: KnowledgeCategory;
}

export interface UpdateKnowledgeRequest {
  title?: string;
  content?: string;
  category?: KnowledgeCategory | null;
}

// ── Company Brain Query (TASK-0403) ────────────────────

/** 조회 순서 — CTO 지시로 고정: Memory → Knowledge → Decision → SOP */
export const COMPANY_BRAIN_SOURCES = [
  "MEMORY",
  "KNOWLEDGE",
  "DECISION",
  "SOP",
] as const;

export type CompanyBrainSource = (typeof COMPANY_BRAIN_SOURCES)[number];

export interface CompanyBrainQueryRequest {
  /** 검색어 (필수) */
  query: string;
  /** Memory 필터 (선택). scope=PROJECT + scopeId면 Decision도 해당 프로젝트로 필터 */
  scope?: MemoryScope;
  scopeId?: string;
  /** 소스별 최대 결과 수 (기본 20, 최대 100) */
  limit?: number;
}

/** SOP 정의 요약 — Query 응답용 */
export interface SopSummaryDto {
  key: string;
  name: string;
  description: string;
  steps: { key: string; name: string }[];
}

export type CompanyBrainSectionDto =
  | { source: "MEMORY"; items: MemoryDto[] }
  | { source: "KNOWLEDGE"; items: KnowledgeDto[] }
  | { source: "DECISION"; items: DecisionDto[] }
  | { source: "SOP"; items: SopSummaryDto[] };

export interface CompanyBrainQueryResponse {
  query: string;
  /** 항상 MEMORY → KNOWLEDGE → DECISION → SOP 순서의 섹션 배열 */
  results: CompanyBrainSectionDto[];
}

// ── READY Validation (TASK-0404) ───────────────────────

/** 검증 판정 3단계 — CTO 지시. 전체 판정은 개별 검사 중 최악 값 */
export const READY_VALIDATION_STATUSES = ["PASS", "WARNING", "FAIL"] as const;

export type ReadyValidationStatus = (typeof READY_VALIDATION_STATUSES)[number];

export interface ReadyValidationCheckDto {
  /** 검사 식별자 (예: banned-words) */
  key: string;
  name: string;
  status: ReadyValidationStatus;
  /** 판정 근거 메시지 */
  messages: string[];
}

export interface ReadyValidationResultDto {
  projectId: string;
  productObjectId: string;
  productObjectVersion: number;
  /** 전체 판정 — 개별 검사 중 최악 값 (FAIL > WARNING > PASS) */
  status: ReadyValidationStatus;
  checks: ReadyValidationCheckDto[];
  validatedAt: string;
}

export interface ReadyValidationRequest {
  /** 검증할 Product Object 버전. 미지정 시 최신 버전 사용 */
  productObjectVersion?: number;
}

// ── LLM Gateway (TASK-0501, Sprint 5 — AI Execution) ───

export const LLM_MESSAGE_ROLES = ["system", "user", "assistant"] as const;

export type LlmMessageRole = (typeof LLM_MESSAGE_ROLES)[number];

export interface LlmMessageDto {
  role: LlmMessageRole;
  content: string;
}

/** 기대 응답 형식 — "json"이면 Provider에 JSON 객체 하나만 출력하도록 요구한다 */
export type LlmResponseFormat = "text" | "json";

/** LLM 요청에 첨부하는 이미지 (멀티모달 — TASK-0505) */
export interface LlmImageDto {
  /** 예: "image/png", "image/jpeg" */
  mimeType: string;
  /** base64로 인코딩된 원본 바이트 */
  base64: string;
}

export interface LlmCompleteRequest {
  messages: LlmMessageDto[];
  /** Provider 기본 모델을 덮어쓸 모델 ID (선택) */
  model?: string;
  /** 최대 출력 토큰 (선택, Provider 기본값 사용) */
  maxTokens?: number;
  /** 기대 응답 형식 (선택, 기본 "text") — 구조화 출력이 필요한 기능이 사용 */
  responseFormat?: LlmResponseFormat;
  /** 첨부 이미지 (선택) — Vision 등 멀티모달 기능이 사용 */
  images?: LlmImageDto[];
}

export interface LlmUsageDto {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LlmCompletionDto {
  provider: string;
  model: string;
  text: string;
  usage: LlmUsageDto;
  createdAt: string;
}

/** 게이트웨이 상태 조회 응답 — 어떤 Provider가 선택되어 있는지 */
export interface LlmGatewayInfoDto {
  provider: string;
  defaultModel: string;
}

// ── Cost Governance & Multi-Provider Foundation (TASK-0902, Sprint 9) ──

export type BudgetStatus = "off" | "ok" | "alert" | "exceeded";

export interface BudgetWindowStatusDto {
  /** 설정된 예산 (USD) — 미설정이면 null(무제한) */
  budget: number | null;
  spend: number;
  ratio: number | null;
  status: BudgetStatus;
}

/** LLM 비용 예산 현황 (TASK-0902) — UTC 일/월 기준 */
export interface LlmBudgetDto {
  daily: BudgetWindowStatusDto;
  monthly: BudgetWindowStatusDto;
  /** 경고 임계 (기본 0.8 = 80%) */
  alertRatio: number;
  checkedAt: string;
}

export type LlmProviderConnectionDto = "official" | "adapter-ready" | "mock";

export interface LlmProviderInfoDto {
  name: string;
  title: string;
  connection: LlmProviderConnectionDto;
  /** API 키 환경변수 설정 여부 (키 값은 노출하지 않음) */
  keyConfigured: boolean;
  /** 현재 LLM_PROVIDER로 선택되어 있는지 */
  selected: boolean;
  defaultModel: string;
  models: string[];
  note: string;
}

/** Provider Registry + Model Routing 현황 (TASK-0902) */
export interface LlmProvidersDto {
  selected: LlmGatewayInfoDto;
  /** feature별 라우팅 모델 (환경변수 미설정이면 null — Provider 기본 모델 사용) */
  routing: Record<string, string | null>;
  providers: LlmProviderInfoDto[];
}

// ── Cross-Provider Routing Engine (TASK-1001, Sprint 10) ──

export type RoutingSource = "feature" | "default" | "fallback";

export interface RoutingResolutionDto {
  feature: string;
  provider: string;
  /** null이면 Provider 기본 모델 */
  model: string | null;
  source: RoutingSource;
  /** fallback 사유 (그 외 null) */
  reason: string | null;
  /** 지정 환경변수 이름 (설정 안내용) */
  env: string;
}

/** feature별 Provider 라우팅 현황 (TASK-1001) */
export interface LlmRoutingDto {
  defaultProvider: string;
  /** 인스턴스가 준비된(키 설정 완료) Provider 목록 */
  availableProviders: string[];
  routes: RoutingResolutionDto[];
  checkedAt: string;
}

// ── Provider Failover Engine (TASK-1002, Sprint 10) ──

export interface ProviderHealthStateDto {
  provider: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  /** 불건강 상태가 풀리는 시각 (건강하면 null) */
  cooldownUntil: string | null;
}

/** Failover 계측 (프로세스 시작 이후 누적 — 인메모리) */
export interface FailoverMetricsDto {
  /** Provider 호출 시도 총합 (Failover 재시도 포함) */
  attempts: number;
  /** 다음 Provider로 넘어간 횟수 */
  failovers: number;
  /** 체인을 모두 소진해 최종 실패한 횟수 */
  exhausted: number;
  /** Failover 제외 대상(Budget/Validation)이라 즉시 실패한 횟수 */
  skipped: number;
  /** Provider별 성공/실패 횟수 */
  byProvider: {
    provider: string;
    success: number;
    failed: number;
  }[];
  /**
   * `GET /llm/health` 진단 호출 (CTO 결정 1002-④로 위 운영 계측과 분리).
   * 건강 상태에는 반영되지만 attempts/failovers/exhausted에는 포함되지 않는다.
   */
  healthChecks: { ok: number; failed: number };
  since: string;
}

/** Provider Failover 현황 (TASK-1002) */
export interface LlmFailoverDto {
  /** 우선순위가 설정되어 Failover가 활성인지 */
  enabled: boolean;
  /** 시도 우선순위 (LLM_FAILOVER_PRIORITY) */
  priority: string[];
  /** Provider 1회 호출 제한 시간(ms) — 0이면 무제한 */
  timeoutMs: number;
  /** Provider별 게이트웨이 재시도 횟수 */
  attemptsPerProvider: number;
  health: ProviderHealthStateDto[];
  metrics: FailoverMetricsDto;
  checkedAt: string;
}

// ── Routing Experiment (TASK-1003, Sprint 10) ─────────

/** 실험 종류 — 선택 알고리즘은 같고 운영자의 의도 선언이 다르다 */
export type ExperimentKindDto = "percentage" | "ab" | "canary" | "weighted";

export interface ExperimentVariantDto {
  /** 집계 키 — `provider` 또는 `provider:model` */
  key: string;
  provider: string;
  model: string | null;
  /** 설정된 가중치 */
  weight: number;
  /** 설정 가중치의 비율 (전체 대비) */
  weightShare: number;
  /** 이 Provider를 실제로 쓸 수 있는지 */
  available: boolean;
  /** 사용 불가 변형을 제외하고 재정규화한 배정 비율 */
  effectiveShare: number;
  /** 프로세스 시작 이후 이 변형에 배정된 호출 수 */
  assignments: number;
  /** 실제 배정 비율 (배정이 없으면 null) */
  actualShare: number | null;
}

export interface ExperimentDto {
  feature: string;
  name: string;
  kind: ExperimentKindDto;
  /** 지정 환경변수명 */
  env: string;
  /** 사용 가능한 변형이 있어 실제로 트래픽이 나뉘는지 */
  active: boolean;
  /** 비활성·부분 제외 사유 (없으면 null) */
  reason: string | null;
  /** 이 실험의 총 배정 횟수 */
  assignments: number;
  variants: ExperimentVariantDto[];
  /** 운영 상태 (TASK-1101) — 정의는 환경변수, 상태는 DB */
  lifecycle: ExperimentLifecycleDto;
}

// ── Experiment Lifecycle & Sticky Assignment (TASK-1101, Sprint 11) ──

/** 실험 운영 상태 — 정의(변형·가중치)는 환경변수가 원천 */
export type ExperimentStatusDto = "RUNNING" | "STOPPED" | "PROMOTED";

/** 상태 전이 동작 */
export type ExperimentActionDto = "START" | "STOP" | "PROMOTE" | "ROLLBACK";

/** 상태 전이 이력 1건 (Rollback 근거 + 감사) */
export interface ExperimentEventDto {
  id: string;
  action: ExperimentActionDto;
  fromStatus: ExperimentStatusDto;
  toStatus: ExperimentStatusDto;
  fromVariant: string | null;
  toVariant: string | null;
  actor: string | null;
  note: string | null;
  createdAt: string;
}

/** feature 하나의 실험 운영 상태 */
export interface ExperimentLifecycleDto {
  feature: string;
  status: ExperimentStatusDto;
  /** 승자 변형 키 (PROMOTED일 때 유효) */
  promotedVariant: string | null;
  actor: string | null;
  note: string | null;
  /** Sticky 배정된 프로젝트 수 */
  assignmentCount: number;
  updatedAt: string | null;
  events: ExperimentEventDto[];
}

/** Project → 변형 Sticky 배정 1건 */
export interface ExperimentAssignmentDto {
  feature: string;
  projectId: string;
  projectName: string | null;
  variantKey: string;
  /** 배정 시점의 실험 정의 서명 — 현재와 다르면 다음 호출에서 재배정 */
  signature: string;
  assignedAt: string;
  updatedAt: string;
}

/** 재배정 이력 1건 (TASK-1102, CTO 결정 1101-⑤) */
export interface ExperimentReassignmentDto {
  feature: string;
  projectId: string;
  /** 재배정 사유 — 실험 정의 변경 / 배정된 변형을 쓸 수 없게 됨 */
  reason: "DEFINITION_CHANGED" | "VARIANT_UNAVAILABLE";
  fromVariant: string | null;
  toVariant: string;
  fromSignature: string | null;
  toSignature: string;
  createdAt: string;
}

/** Assignment Dashboard 응답 (TASK-1101) */
export interface ExperimentAssignmentsDto {
  assignments: ExperimentAssignmentDto[];
  /** feature별 변형 배정 분포 */
  distribution: { variantKey: string; projects: number }[];
  /** 재배정 이력 (TASK-1102) */
  reassignments: ExperimentReassignmentDto[];
}

// ── Experiment Analytics & Recommendation (TASK-1102, Sprint 11) ──

/** 변형 1개의 성과 요약 */
export interface ExperimentVariantPerformanceDto {
  key: string;
  provider: string;
  model: string | null;
  /** 설정된 배정 가중치 비율 */
  weightShare: number | null;
  calls: number;
  successes: number;
  failures: number;
  /** 성공률 (호출이 없으면 null) */
  successRate: number | null;
  /** Wilson 95% 신뢰구간 하한·상한 — 표본이 적을 때 과신 방지 */
  successRateLow: number | null;
  successRateHigh: number | null;
  avgLatencyMs: number | null;
  /** 합계 비용(USD) — 가격표 없는 모델은 null */
  cost: number | null;
  /** 호출당 비용(USD) */
  costPerCall: number | null;
  inputTokens: number;
  outputTokens: number;
}

/** 기준(baseline) 대비 비교 */
export interface ExperimentComparisonDto {
  key: string;
  /** 성공률 차이 (비율 포인트, +면 우세) */
  successRateDelta: number | null;
  /** 평균 지연 차이(ms, −면 빠름) */
  latencyDelta: number | null;
  /** 호출당 비용 차이(USD, −면 저렴) */
  costPerCallDelta: number | null;
  /** 성공률 차이가 우연이 아닐 신뢰도 (0~1) */
  successRateConfidence: number;
}

/** 승자 추천 근거 종류 */
export type RecommendationBasisDto =
  | "success-rate"
  | "cost"
  | "latency"
  | "insufficient-data"
  | "no-variants";

/** 승자 추천 (승격은 운영자 수동 절차 — CTO 결정 1101-③) */
export interface ExperimentRecommendationDto {
  winner: string | null;
  basis: RecommendationBasisDto;
  /** 신뢰도 0~1 */
  confidence: number;
  /** 사람이 읽는 근거 */
  reason: string;
  /** 통계적으로 확정으로 볼 수 있는지 */
  conclusive: boolean;
}

/** Experiment Analytics 응답 (TASK-1102) */
export interface ExperimentAnalyticsDto {
  feature: string;
  name: string;
  /** 실험 정의(환경변수)가 있는지 */
  configured: boolean;
  status: ExperimentStatusDto;
  promotedVariant: string | null;
  /** 관측 시작 시각 (전체 기간이면 null) */
  since: string | null;
  totalCalls: number;
  /** 비교 기준 변형 */
  baseline: string | null;
  variants: ExperimentVariantPerformanceDto[];
  comparisons: ExperimentComparisonDto[];
  recommendation: ExperimentRecommendationDto;
  checkedAt: string;
}

/** 상태 전이 요청 본문 */
export interface ExperimentTransitionRequest {
  /** PROMOTE 대상 변형 키 (`provider` 또는 `provider:model`) */
  variantKey?: string;
  note?: string;
}

/** Routing Experiment 현황 (TASK-1003) */
export interface LlmExperimentsDto {
  availableProviders: string[];
  experiments: ExperimentDto[];
  checkedAt: string;
}

/** LLM Provider 상태 점검 결과 (TASK-0603) — 최소 완성 호출로 확인 */
export interface LlmHealthDto {
  provider: string;
  model: string;
  status: "ok" | "error";
  latencyMs: number;
  error: string | null;
  checkedAt: string;
}

// ── Execution Domain (TASK-0601, Sprint 6) ─────────────

export const EXECUTION_STATUSES = ["SUCCESS", "FAILED"] as const;

/** LLM 호출 1건의 실행 결과 상태 */
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export interface ExecutionDto {
  id: string;
  /** 호출 기능 (content-generation | product-analysis | vision-analysis | dev) */
  feature: string;
  provider: string;
  model: string;
  status: ExecutionStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  /** 예상 비용 (USD) — 가격표에 없는 모델은 null */
  cost: number | null;
  latencyMs: number;
  error: string | null;
  createdAt: string;
}

/** Execution 집계 통계 (TASK-0602) — 비율은 0~1, 표본 없으면 null */
export interface ExecutionStats {
  count: number;
  successCount: number;
  failedCount: number;
  successRate: number | null;
  failureRate: number | null;
  inputTokens: number;
  outputTokens: number;
  /** 비용 합계 (USD) — 가격 산정된 호출이 없으면 null */
  cost: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
}

export interface ExecutionGroupStatsDto {
  key: string;
  stats: ExecutionStats;
}

export interface ExecutionDashboardDto {
  /** 조회 기간 (미지정 시 null — 전체 기간) */
  range: { from: string | null; to: string | null };
  totals: ExecutionStats;
  byFeature: ExecutionGroupStatsDto[];
  byProvider: ExecutionGroupStatsDto[];
  byModel: ExecutionGroupStatsDto[];
  /**
   * Routing Metrics (TASK-1001) — 실제 실행된 경로별 집계.
   * key는 `${feature}→${provider}` 형식이다.
   */
  byRoute: ExecutionGroupStatsDto[];
  /**
   * Experiment Metrics (TASK-1003) — 실험 변형별 집계.
   * key는 `${feature}→${provider}:${model}` 형식으로, 같은 Provider의
   * 모델 변형까지 구분한다 (A/B·Canary 비교용).
   */
  byVariant: ExecutionGroupStatsDto[];
}

// ── Execution Timeline (TASK-0605) ─────────────────────

export const EXECUTION_TIMELINE_INTERVALS = ["hour", "day", "week"] as const;

export type ExecutionTimelineInterval =
  (typeof EXECUTION_TIMELINE_INTERVALS)[number];

export interface ExecutionTimelineBucketDto {
  /** 버킷 시작 시각 (ISO, UTC date_trunc 기준) */
  bucketStart: string;
  stats: ExecutionStats;
}

export interface ExecutionTimelineDto {
  interval: ExecutionTimelineInterval;
  range: { from: string | null; to: string | null };
  /** 적용된 필터 (미적용 필드는 null) */
  filter: {
    feature: string | null;
    provider: string | null;
    model: string | null;
  };
  /** 시간 오름차순 — 데이터가 있는 버킷만 포함 */
  buckets: ExecutionTimelineBucketDto[];
}

// ── Prompt Engine (TASK-0503) ──────────────────────────

export interface PromptTemplateInfoDto {
  key: string;
  name: string;
  description: string;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ── Provider Administration Console (TASK-1201, Sprint 12) ──

/** 설정 값의 출처 — override(콘솔) / env(환경변수) / default(기본값) */
export type SettingSourceDto = "override" | "env" | "default";

/** 해석된 설정 1건 — 지금 적용 중인 값과 해제 시 되돌아갈 값 */
export interface ResolvedSettingDto {
  key: string;
  value: string | null;
  source: SettingSourceDto;
  /** 오버라이드를 지웠을 때 되돌아갈 값 */
  fallback: string | null;
  env: string | null;
}

/** Provider Enable/Disable 항목 */
export interface AdminProviderDto {
  name: string;
  title: string;
  connection: LlmProviderConnectionDto;
  defaultModel: string;
  models: string[];
  /** API 키가 설정되어 있는지 (값은 노출하지 않음) */
  keyConfigured: boolean;
  /** 콘솔에서 켜져 있는지 */
  enabled: boolean;
  /** 실제로 라우팅 후보인지 (키 + 활성 모두 충족) */
  available: boolean;
  setting: ResolvedSettingDto;
}

/** Model Management 항목 */
export interface AdminModelDto {
  feature: string;
  setting: ResolvedSettingDto;
  /** 라우팅이 실제로 고른 모델 (null이면 Provider 기본) */
  effective: string | null;
}

/** Experiment Management 항목 */
export interface AdminExperimentSettingDto {
  feature: string;
  setting: ResolvedSettingDto;
}

/** 콘솔 전체 현황 */
export interface AdminConsoleDto {
  providers: AdminProviderDto[];
  models: AdminModelDto[];
  budget: {
    daily: ResolvedSettingDto;
    monthly: ResolvedSettingDto;
    alertRatio: ResolvedSettingDto;
    /** 현재 지출·경고 상태 */
    status: LlmBudgetDto;
  };
  experiments: AdminExperimentSettingDto[];
  checkedAt: string;
}

/** 설정 변경 요청 — value가 null이면 오버라이드 해제(환경변수로 복귀) */
export interface AdminSettingUpdateRequest {
  value: string | null;
  note?: string | null;
}

export interface AdminSettingUpdatedDto {
  key: string;
  value: string | null;
  updatedAt: string;
}

/** 콘솔 조작 감사 이력 1건 */
export interface AdminAuditEntryDto {
  id: string;
  actor: string | null;
  action: "SETTING_UPDATED" | "SETTING_CLEARED";
  key: string;
  before: string | null;
  after: string | null;
  note: string | null;
  createdAt: string;
}

// ── Production Readiness (TASK-1202, Sprint 12) ──

export type EnvSeverityDto = "error" | "warning";
export type EnvCategoryDto =
  | "core"
  | "database"
  | "storage"
  | "auth"
  | "llm"
  | "ops";

/** 환경 검증 문제 1건 */
export interface EnvIssueDto {
  name: string;
  severity: EnvSeverityDto;
  message: string;
  category: EnvCategoryDto;
}

/** 설정 현황 1건 — 비밀 값은 설정 여부만 노출 */
export interface EnvSettingViewDto {
  name: string;
  category: EnvCategoryDto;
  description: string;
  requiredInProduction: boolean;
  configured: boolean;
  /** 비밀이 아닌 값의 실제 값 (비밀이면 null) */
  value: string | null;
  secret: boolean;
  fallback: string | null;
}

/** 구성 요소 점검 결과 (DB·저장소 등) */
export interface ComponentHealthDto {
  name: string;
  ok: boolean;
  detail: string;
  latencyMs: number;
}

export type ChecklistStatusDto = "pass" | "fail" | "warn" | "manual";

/** 배포 체크리스트 1건 */
export interface ChecklistItemDto {
  id: string;
  title: string;
  status: ChecklistStatusDto;
  detail: string;
  /** 실패 시 배포를 막아야 하는가 */
  blocking: boolean;
}

export interface ReadinessSummaryDto {
  ready: boolean;
  pass: number;
  fail: number;
  warn: number;
  manual: number;
  blockers: ChecklistItemDto[];
}

/** 배포 준비 보고 (Health Dashboard 원천) */
export interface ReadinessReportDto {
  /** 배포 가능한가 (blocking 실패 없음) */
  ready: boolean;
  production: boolean;
  nodeEnv: string;
  environment: {
    ok: boolean;
    errors: EnvIssueDto[];
    warnings: EnvIssueDto[];
    checked: number;
  };
  components: ComponentHealthDto[];
  /** 미적용 마이그레이션 수 (확인 불가면 null) */
  pendingMigrations: number | null;
  providers: { available: string[]; default: string };
  checklist: ChecklistItemDto[];
  summary: ReadinessSummaryDto;
  configuration: EnvSettingViewDto[];
  checkedAt: string;
}

/** 간단 생존 확인 (인증 불필요) */
export interface LivenessDto {
  status: "ok";
  uptimeSeconds: number;
  nodeEnv: string;
}

// ── Real AI Provider Production Integration (TASK-1301, Sprint 13) ──

/** API Key 형식 판정 — 형식만 본다 (유효성은 Live Check로 확인) */
export type ApiKeyFormatStatusDto = "ok" | "missing" | "invalid" | "placeholder";

/** Provider 1개의 연결 준비 상태 (GET /llm/providers/validate) */
export interface ProviderValidationDto {
  provider: string;
  title: string;
  /** 키 환경변수 이름 (mock 등 키가 없으면 null) */
  keyEnv: string | null;
  /** 형식 판정 */
  format: ApiKeyFormatStatusDto;
  /** 사람이 읽는 설명 */
  message: string;
  /** 키 앞부분 힌트 (값은 절대 노출하지 않는다) */
  hint: string | null;
  /** 키 길이 (미설정이면 null) */
  length: number | null;
  /** 설정상 이 Provider를 참조하는가 → 운영에서 키가 필수 (CTO 결정 1202-②) */
  required: boolean;
  /** 실제 어댑터가 만들어졌는가 (키가 있어야 생성된다) */
  instantiated: boolean;
  defaultModel: string;
  /** Live Check 결과 — 요청하지 않았으면 null */
  live: LlmHealthDto | null;
}

export interface ProviderValidationReportDto {
  /** 운영에서 막히는 문제가 없으면 true */
  ok: boolean;
  production: boolean;
  /** Live Check를 수행했는가 (실제 API 호출·과금 발생) */
  liveChecked: boolean;
  providers: ProviderValidationDto[];
  /** 조치가 필요한 항목 요약 */
  blockers: string[];
  checkedAt: string;
}

/** 비용 검증 문제 1건 */
export interface CostIssueDto {
  kind: "unpriced" | "mismatch" | "missing-usage";
  provider: string;
  model: string;
  count: number;
  message: string;
  sampleIds: string[];
  recordedTotal?: number;
  expectedTotal?: number;
}

/** 기록된 비용 검증 (GET /llm/cost-verification) */
export interface CostVerificationDto {
  ok: boolean;
  /** 검사 구간 (시간) */
  hours: number;
  checked: number;
  unpricedCalls: number;
  recordedTotal: number;
  expectedTotal: number;
  issues: CostIssueDto[];
  /** 가격표에 등록된 모델 단가 (USD / 1M tokens) */
  pricing: {
    model: string;
    inputPerMillion: number;
    outputPerMillion: number;
  }[];
  checkedAt: string;
}

export type MonitorStatusDto = "healthy" | "degraded" | "down" | "unknown";

export interface ProviderMonitorRowDto {
  provider: string;
  calls: number;
  successCount: number;
  failedCount: number;
  successRate: number | null;
  latency: { p50: number; p95: number; p99: number; max: number } | null;
  cost: number | null;
  costPerCall: number | null;
  unpricedCalls: number;
  models: string[];
  lastCallAt: string | null;
  status: MonitorStatusDto;
}

export interface MonitorAlertDto {
  level: "warning" | "critical";
  provider: string;
  message: string;
}

/** 운영 모니터링 (GET /llm/monitoring) */
export interface ProductionMonitorDto {
  status: MonitorStatusDto;
  windowMinutes: number;
  minSamples: number;
  totals: {
    calls: number;
    successCount: number;
    failedCount: number;
    successRate: number | null;
    cost: number | null;
    unpricedCalls: number;
  };
  providers: ProviderMonitorRowDto[];
  alerts: MonitorAlertDto[];
  /**
   * 관측에서 **제외된** 진단 호출 수 (TASK-1302, CTO 결정 1301-③).
   * 제외하되 숨기지는 않는다 — 진단이 실패하는 것도 알아야 할 정보다.
   */
  diagnosticCalls: number;
  checkedAt: string;
}

// ── Production Automation & Alerting (TASK-1302, Sprint 13) ──

export const ALERT_KIND_VALUES = [
  "budget",
  "provider-failure",
  "unpriced-model",
  "configuration",
  // 예약 점검 정지 (TASK-1501, CTO 결정 1401-①)
  "scheduler-stopped",
] as const;

export type AlertKindDto = (typeof ALERT_KIND_VALUES)[number];
export type AlertLevelDto = "warning" | "critical";
export type AlertStatusDto = "ACTIVE" | "RESOLVED" | "ARCHIVED";

/** 경보 1건 — key가 같으면 같은 문제로 본다 */
export interface AlertDto {
  id: string;
  kind: AlertKindDto;
  key: string;
  level: AlertLevelDto;
  title: string;
  message: string;
  status: AlertStatusDto;
  /** 같은 경보가 다시 감지된 횟수 */
  occurrences: number;
  firstRaisedAt: string;
  lastRaisedAt: string;
  /** 마지막으로 외부 채널에 알린 시각 (없으면 아직 알리지 않음) */
  notifiedAt: string | null;
  resolvedAt: string | null;
  /** 보관 시각 (TASK-1401, CTO 결정 1302-④) — 삭제하지 않는다 */
  archivedAt: string | null;
}

/** 예약 점검 1회 실행 이력 */
export interface CheckRunDto {
  id: string;
  job: string;
  ok: boolean;
  detail: string;
  alertsRaised: number;
  durationMs: number;
  /** schedule | manual */
  trigger: string;
  createdAt: string;
}

/** 예약 점검 구성 (간격·활성 여부) */
export interface JobScheduleDto {
  job: string;
  intervalMs: number;
  /** 시각 기반 점검이면 자정 이후 분 (UTC) — 간격 기반이면 null */
  dailyAtMinutes: number | null;
  enabled: boolean;
  /** env | default | disabled */
  source: string;
  env: string;
  lastRunAt: string | null;
  lastResult: CheckRunDto | null;
}

/** 경보·자동 점검 현황 (GET /ops/alerts) */
export interface AlertBoardDto {
  /** critical 경보가 하나도 없으면 true */
  ok: boolean;
  summary: {
    total: number;
    critical: number;
    warning: number;
  };
  active: AlertDto[];
  recent: AlertDto[];
  schedules: JobScheduleDto[];
  /** 외부 알림 채널 구성 여부 (URL은 노출하지 않는다) */
  webhookConfigured: boolean;
  /** 같은 경보 재알림 간격 (ms) — 종류별 (CTO 결정 1302-①) */
  cooldownMs: number;
  cooldownByKind: Record<string, number>;
  /** 알림 채널 현황 (TASK-1401) */
  channels: NotificationChannelStatusDto[];
  /** 최근 전송 시도 (TASK-1401) */
  deliveries: NotificationDeliveryDto[];
  /** 예약 실행 조율 현황 (TASK-1401) */
  coordination: SchedulerCoordinationDto;
  checkedAt: string;
}

/** 점검 실행 결과 (POST /ops/checks/run) */
export interface CheckRunResultDto {
  job: string;
  ok: boolean;
  detail: string;
  alertsRaised: number;
  durationMs: number;
  trigger: string;
  /** 이번 실행에서 알린 경보 */
  notified: {
    key: string;
    action: string;
    level: AlertLevelDto | null;
    title: string;
  }[];
}

// ── Production Operations Platform (TASK-1401, Sprint 14) ──

export type NotificationChannelDto = "slack" | "email" | "webhook";

/** 알림 채널 구성 — 주소(웹훅 URL·SMTP·수신자)는 노출하지 않는다 */
export interface NotificationChannelStatusDto {
  channel: NotificationChannelDto;
  enabled: boolean;
  /** 이 채널이 받을 최소 심각도 */
  minLevel: "warning" | "critical";
  /** 해소 알림도 받는가 */
  resolved: boolean;
  /** 설정 환경변수 이름 (값이 아니라 이름만) */
  env: string;
}

/** 알림 전송 시도 1건 — "왜 아무도 못 받았는가"의 근거 */
export interface NotificationDeliveryDto {
  id: string;
  alertKey: string;
  channel: string;
  level: string;
  ok: boolean;
  /** 총 시도 횟수 (최초 1회 포함) */
  attempts: number;
  status: number | null;
  error: string | null;
  createdAt: string;
}

/** 분산 잠금 임차 상태 */
export interface LeaseStatusDto {
  key: string;
  /** 현재 리더 (만료됐으면 null) */
  owner: string | null;
  /** 내가 리더인가 */
  self: boolean;
  expiresAt: string | null;
  remainingMs: number;
}

/** 예약 실행 조율 현황 */
export interface SchedulerCoordinationDto {
  /** Redis 기반 분산 조율을 쓰는가 — false면 단일 인스턴스 모드 */
  distributed: boolean;
  /** 잠금 저장소를 지금 쓸 수 있는가 — false면 예약 점검이 돌지 않는다 */
  lockHealthy: boolean;
  /** 이 인스턴스 식별자 */
  instance: string;
  lockTtlMs: number;
  leases: LeaseStatusDto[];
}

/** 경보 이력 요약 */
export interface AlertHistorySummaryDto {
  total: number;
  active: number;
  resolved: number;
  archived: number;
  byKind: { kind: string; alerts: number; occurrences: number }[];
  /** 해소까지 걸린 평균 시간 (ms) — 해소된 것이 없으면 null */
  meanTimeToResolveMs: number | null;
}

/** 경보 이력 (GET /ops/alerts/history) */
export interface AlertHistoryDto {
  entries: AlertDto[];
  summary: AlertHistorySummaryDto;
  /** 보관 유예 (일) */
  archiveAfterDays: number;
  checkedAt: string;
}

/** 보관 실행 결과 (POST /ops/alerts/archive) */
export interface AlertArchiveResultDto {
  archived: number;
  keys: string[];
  afterDays: number;
  /** 이 시각 이전에 해소된 것이 대상 */
  cutoff: string;
  checked: number;
}

// ── High Availability & Operations Reliability (TASK-1501, Sprint 15) ──

/** 알림 큐 항목 1건 */
export interface NotificationQueueDto {
  id: string;
  alertKey: string;
  channel: string;
  level: string;
  title: string;
  /** PENDING | SENT | DEAD | ARCHIVED */
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastStatus: number | null;
  lastError: string | null;
  sentAt: string | null;
  deadAt: string | null;
  createdAt: string;
}

/** 알림 큐 현황 (GET /ops/notifications/queue) */
export interface NotificationQueueStatusDto {
  pending: number;
  sent: number;
  /** Dead Letter — 사람이 고쳐야 나간다 */
  dead: number;
  /** 지금 보낼 수 있는 항목 수 */
  due: number;
  /** 90일이 지나 보관된 Dead Letter (CTO 결정 1501-③ — 삭제 아님) */
  archived: number;
  workerEnabled: boolean;
  workerIntervalMs: number;
  deadLetters: NotificationQueueDto[];
  recent: NotificationQueueDto[];
}

// ── Production Verification & Operational Readiness (TASK-1601, Sprint 16) ──

/** 백업 실행 이력 1건 */
export interface BackupRunDto {
  id: string;
  ok: boolean;
  /** 덤프 크기 (bytes) — 실패면 null */
  sizeBytes: number | null;
  /** 파일명만 (절대 경로는 노출하지 않는다) */
  fileName: string | null;
  durationMs: number;
  trigger: string;
  error: string | null;
  /** SHA-256 (TASK-1701) */
  checksum: string | null;
  /** pg_restore --list로 읽히는가 — 확인하지 못했으면 null */
  integrityOk: boolean | null;
  /** 덤프 안에서 확인한 객체 수 */
  entries: number | null;
  /** 원격 저장소에 사본이 있는가 (키는 노출하지 않는다) */
  offsite: boolean;
  createdAt: string;
}

/** 복원 검증 이력 1건 */
export interface RestoreRunDto {
  id: string;
  ok: boolean;
  /** 복원 후 확인한 테이블 수 */
  tables: number | null;
  fileName: string | null;
  durationMs: number;
  trigger: string;
  error: string | null;
  createdAt: string;
}

export type ReadinessVerdictDto = "ok" | "stale" | "failed" | "missing";
export type DrStatusDto = "pass" | "fail" | "warn" | "manual";

export interface DrItemDto {
  id: string;
  title: string;
  status: DrStatusDto;
  detail: string;
  /** 복구 가능성을 좌우하는 항목인가 */
  critical: boolean;
}

/** SMTP 검증 결과 — 연결·인증만 확인하고 메일은 보내지 않는다 */
export interface SmtpValidationDto {
  configured: boolean;
  ok: boolean;
  detail: string;
  host: string | null;
  latencyMs: number;
}

/** Redis(분산 잠금) 상태 */
export interface RedisHealthDto {
  /** Redis를 쓰는 구성인가 */
  configured: boolean;
  ok: boolean;
  detail: string;
  latencyMs: number | null;
  /** 잠금 불가가 시작된 시각 — 정상이면 null */
  unhealthySince: string | null;
  /** 이 시간 이상 지속되면 critical (CTO 결정 1501-②) */
  outageThresholdMs: number;
}

/** 저장소 보호 상태 (CTO 결정 1601-④) */
export type ProtectionStateDto = "enabled" | "disabled" | "unknown";

/** 복구 목표 (RPO·RTO, TASK-1701) */
export interface RecoveryObjectivesDto {
  /** 지금 무너지면 잃을 최대 구간 (ms) */
  rpoMs: number | null;
  rpoTargetMs: number;
  rpoMet: boolean | null;
  /** 복원에 실제로 걸린 시간 (측정치, ms) */
  rtoMs: number | null;
  rtoTargetMs: number;
  rtoMet: boolean | null;
  status: DrStatusDto;
  detail: string;
}

/** Enterprise 백업·재해 복구 (TASK-1701) */
export interface EnterpriseRecoveryDto {
  integrity: { status: DrStatusDto; detail: string };
  offsite: {
    status: DrStatusDto;
    detail: string;
    /** 원격 복제를 쓰는 구성인가 */
    configured: boolean;
    copies: number;
  };
  storageProtection: {
    status: DrStatusDto;
    detail: string;
    versioning: ProtectionStateDto;
    replication: ProtectionStateDto;
  };
  objectives: RecoveryObjectivesDto;
  restoreTarget: {
    status: DrStatusDto;
    detail: string;
    verdict: "ok" | "same-as-production" | "not-configured";
  };
  /** 복구 리허설 (TASK-1801) */
  drill: RecoveryDrillStatusDto;
  /** 백업 전용 버킷 — 이미지 버킷과 분리 (CTO 결정 1701-②) */
  backupBucket: {
    name: string;
    separated: boolean;
    /** 백업 버킷 보호 상태 (CTO 결정 1801-③) */
    protection: {
      status: DrStatusDto;
      detail: string;
      versioning: ProtectionStateDto;
      replication: ProtectionStateDto;
    };
  };
  /** 백업 소요 시간 (CTO 결정 1801-①) */
  performance: BackupPerformanceDto;
  /** 백업 사슬·원격 사본·규모·저장소 표준 (TASK-2001) */
  backupIntegrity: {
    chain: {
      status: DrStatusDto;
      detail: string;
      expected: number;
      actual: number;
      longestGapMs: number | null;
      /** 관측 창 (ms)과 그 출처 — env·default·clamped (TASK-2101) */
      windowMs: number;
      windowSource: "env" | "default" | "clamped" | "invalid";
      windowDetail: string;
    };
    remote: {
      status: DrStatusDto;
      detail: string;
      verdict: string;
      /** 수동 대조가 볼 수 있는 최대 건수 (TASK-2201, CTO 결정 2101-①) */
      maxManualCount: number;
      /** 마지막 자동/수동 대조 시각 (ISO) — 대조한 적 없으면 null */
      checkedAt: string | null;
      /** 자동 대조 주기 (ms) — 주 1회 (CTO 결정 2001-②) */
      intervalMs: number;
      /** 운영에서 자동으로 도는가 */
      scheduled: boolean;
    };
    scale: {
      status: DrStatusDto;
      detail: string;
      bytes: number | null;
      reachedMilestone: number | null;
      nextMilestone: number | null;
    };
    storageStandard: { status: DrStatusDto; detail: string; standard: boolean };
  };
  /**
   * 저장소 프로비저닝 경계 (TASK-2201, CTO 결정 2101-④).
   *
   * `external`이면 운영 담당자가 버킷·IAM을 준비하고 애플리케이션은
   * 환경변수만 씁니다.
   */
  storageProvisioning: {
    mode: "managed" | "external";
    detail: string;
  };
}

/**
 * 원격 사본 대조 결과 (POST /ops/backup/verify-remote).
 *
 * 건마다 결과를 담는다 — **어느 백업이 온전한지**가 복구 시점 선택의
 * 근거이므로, 합쳐 놓으면 그 정보가 사라진다.
 */
export interface RemoteVerifyResultDto {
  status: DrStatusDto;
  detail: string;
  checked: number;
  ok: number;
  failed: number;
  entries: {
    fileName: string | null;
    result: { verdict: string; status: DrStatusDto; detail: string };
  }[];
}

/** 복구 리허설 기록 1건 (TASK-1801, CTO 결정 1701-⑤) */
export interface RecoveryDrillDto {
  id: string;
  ok: boolean;
  performedBy: string;
  durationMs: number | null;
  findings: string | null;
  notes: string | null;
  createdAt: string;
}

/** 리허설을 요구하는 변경 사건 (TASK-1901, CTO 결정 1801-⑤) */
export interface DrillRequirementDto {
  id: string;
  /** dr-change | db-major-change | pitr-adoption */
  trigger: string;
  description: string;
  registeredBy: string;
  /** 해소된 시각 — 미해소면 null */
  satisfiedAt: string | null;
  /** 취소 (TASK-2001, CTO 결정 1901-② — 삭제는 금지) */
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
}

/** 백업 소요 시간 (TASK-1901, CTO 결정 1801-①) */
export interface BackupPerformanceDto {
  level: "normal" | "warning" | "alert" | "critical";
  status: DrStatusDto;
  detail: string;
  latestMs: number | null;
  medianMs: number | null;
  slowStreak: number;
}

/** 복구 리허설 현황 */
export interface RecoveryDrillStatusDto {
  status: DrStatusDto;
  detail: string;
  /** 마지막 리허설 이후 경과 (ms) */
  ageMs: number | null;
  /** 다음 예정일 (ISO) */
  dueAt: string | null;
  overdueDays: number;
  intervalDays: number;
  history: RecoveryDrillDto[];
  /** 아직 해소되지 않은 변경 사건 (TASK-1901) */
  pendingTriggers: string[];
  requirements: DrillRequirementDto[];
  /** 기동 시 Major Migration 자동 등록 결과 (TASK-2101, CTO 결정 2001-④) */
  autoRegistration: DrillAutoRegistrationDto;
}

/**
 * 기동 시 자동 등록 결과 (TASK-2101, CTO 결정 2001-④).
 *
 * `registered`가 `null`이면 **확인하지 못한 것**이다 — 등록할 것이 없었다는
 * 뜻이 아니다.
 */
export interface DrillAutoRegistrationDto {
  checkedAt: string | null;
  /** 적용된 Major Migration 목록 */
  applied: string[];
  registered: boolean | null;
  detail: string;
}

/** 운영 대시보드 (GET /ops/readiness) */
export interface OperationsReadinessDto {
  /** critical 항목이 전부 통과하면 true */
  recoverable: boolean;
  summary: { pass: number; fail: number; warn: number; manual: number };
  checklist: DrItemDto[];
  backup: {
    verdict: ReadinessVerdictDto;
    message: string;
    ageMs: number | null;
    sizeBytes: number | null;
    history: BackupRunDto[];
    directory: string;
    retentionDays: number;
  };
  restore: {
    verdict: ReadinessVerdictDto;
    message: string;
    ageMs: number | null;
    tables: number | null;
    history: RestoreRunDto[];
    /** 복원 검증용 별도 DB가 설정되어 있는가 */
    configured: boolean;
  };
  smtp: SmtpValidationDto;
  redis: RedisHealthDto;
  /** Enterprise 백업·재해 복구 (TASK-1701) */
  enterprise: EnterpriseRecoveryDto;
  checkedAt: string;
}

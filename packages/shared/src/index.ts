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

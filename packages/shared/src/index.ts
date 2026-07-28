export const APP_NAME = "AI Product Content OS";

export type HealthStatus = "OK" | "DEGRADED" | "DOWN";

export type ContentStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";

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
  createdAt: string;
  updatedAt: string;
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

export interface LlmCompleteRequest {
  messages: LlmMessageDto[];
  /** Provider 기본 모델을 덮어쓸 모델 ID (선택) */
  model?: string;
  /** 최대 출력 토큰 (선택, Provider 기본값 사용) */
  maxTokens?: number;
  /** 기대 응답 형식 (선택, 기본 "text") — 구조화 출력이 필요한 기능이 사용 */
  responseFormat?: LlmResponseFormat;
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

// ── Prompt Engine (TASK-0503) ──────────────────────────

export interface PromptTemplateInfoDto {
  key: string;
  name: string;
  description: string;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

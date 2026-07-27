/**
 * Decision Log — 의사결정 기록 도메인. (TASK-0306, Company Brain 소속)
 *
 * 프로젝트 진행 중 내린 결정(무엇을·왜)을 엔티티로 보존한다.
 * 저장 방식은 DecisionRepository Port 뒤에 숨는다 —
 * Prisma 어댑터는 apps/api에 있다. 자세한 구조: docs/architecture/decision.md
 */
export interface Decision {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  /** 결정의 근거 */
  reason: string;
  /** 결정 유형 (예: architecture, process, product — 자유 문자열) */
  decisionType: string;
  author: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDecisionInput {
  projectId: string;
  title: string;
  description?: string | null;
  reason: string;
  decisionType: string;
  author: string;
}

export interface UpdateDecisionInput {
  title?: string;
  description?: string | null;
  reason?: string;
  decisionType?: string;
  author?: string;
}

/** Decision 저장소 Port — 인프라(Prisma 등)가 구현한다 */
export interface DecisionRepository {
  create(input: CreateDecisionInput): Promise<Decision>;
  findById(id: string): Promise<Decision | null>;
  /** 프로젝트의 결정 목록 (최신순) */
  findByProjectId(projectId: string): Promise<Decision[]>;
  update(id: string, input: UpdateDecisionInput): Promise<Decision>;
  delete(id: string): Promise<void>;
}

const REQUIRED_FIELDS = ["title", "reason", "decisionType", "author"] as const;

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/** 생성 입력 검증 — 필수 필드(title/reason/decisionType/author) 공백 불가 */
export function validateCreateDecision(
  input: Partial<CreateDecisionInput>,
): string[] {
  return REQUIRED_FIELDS.filter((field) => isBlank(input[field])).map(
    (field) => `${field}은(는) 비어 있을 수 없습니다.`,
  );
}

/** 수정 입력 검증 — 지정된 필수 필드는 공백으로 바꿀 수 없다 */
export function validateUpdateDecision(input: UpdateDecisionInput): string[] {
  return REQUIRED_FIELDS.filter(
    (field) => input[field] !== undefined && isBlank(input[field]),
  ).map((field) => `${field}은(는) 비어 있을 수 없습니다.`);
}

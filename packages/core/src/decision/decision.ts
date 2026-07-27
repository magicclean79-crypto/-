import { DECISION_TYPES } from "@acos/shared";
import type { DecisionType } from "@acos/shared";

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
  /** 결정 유형 — Enum 고정 (CTO 결정) */
  decisionType: DecisionType;
  author: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDecisionInput {
  projectId: string;
  title: string;
  description?: string | null;
  reason: string;
  decisionType: DecisionType;
  author: string;
}

export interface UpdateDecisionInput {
  title?: string;
  description?: string | null;
  reason?: string;
  decisionType?: DecisionType;
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

function isValidType(value: unknown): boolean {
  return (DECISION_TYPES as readonly string[]).includes(value as string);
}

const TYPE_ERROR = `decisionType은 다음 중 하나여야 합니다: ${DECISION_TYPES.join(", ")}`;

/**
 * 생성 입력 검증 — 필수 필드(title/reason/decisionType/author) 공백 불가,
 * decisionType은 Enum 값만 허용.
 */
export function validateCreateDecision(
  input: Partial<CreateDecisionInput>,
): string[] {
  const errors = REQUIRED_FIELDS.filter((field) => isBlank(input[field])).map(
    (field) => `${field}은(는) 비어 있을 수 없습니다.`,
  );
  if (!isBlank(input.decisionType) && !isValidType(input.decisionType)) {
    errors.push(TYPE_ERROR);
  }
  return errors;
}

/** 수정 입력 검증 — 지정된 필수 필드는 공백 불가, decisionType은 Enum 값만 허용 */
export function validateUpdateDecision(input: UpdateDecisionInput): string[] {
  const errors = REQUIRED_FIELDS.filter(
    (field) => input[field] !== undefined && isBlank(input[field]),
  ).map((field) => `${field}은(는) 비어 있을 수 없습니다.`);
  if (
    input.decisionType !== undefined &&
    !isBlank(input.decisionType) &&
    !isValidType(input.decisionType)
  ) {
    errors.push(TYPE_ERROR);
  }
  return errors;
}

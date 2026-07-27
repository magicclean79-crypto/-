import { KNOWLEDGE_CATEGORIES } from "@acos/shared";
import type { KnowledgeCategory } from "@acos/shared";

/**
 * Knowledge — 회사의 공식 지식 도메인. (TASK-0401, Company Brain 소속)
 *
 * 프로젝트별 경험이 쌓이는 Memory(기억)와 달리, Knowledge는 회사 전역에
 * 적용되는 지식(규칙·정책·가이드 — 예: 금지어, 필수 고지, 브랜드 가이드)을
 * 보존한다. 특정 프로젝트에 속하지 않으며, 이후 Company Brain Query·READY
 * 검증(승인 대기 TASK)이 모든 프로젝트에 대해 참조하는 원천이 된다.
 * 저장 방식은 KnowledgeRepository Port 뒤에 숨는다 — Prisma 어댑터는
 * apps/api에 있다. 자세한 구조: docs/architecture/knowledge.md
 */
export interface Knowledge {
  id: string;
  title: string;
  /** 지식 본문 */
  content: string;
  /** 지식 분류 — Enum 고정 (CTO 결정, 선택 필드) */
  category: KnowledgeCategory | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeInput {
  title: string;
  content: string;
  category?: KnowledgeCategory | null;
}

export interface UpdateKnowledgeInput {
  title?: string;
  content?: string;
  category?: KnowledgeCategory | null;
}

/** Knowledge 저장소 Port — 인프라(Prisma 등)가 구현한다 */
export interface KnowledgeRepository {
  create(input: CreateKnowledgeInput): Promise<Knowledge>;
  findById(id: string): Promise<Knowledge | null>;
  /** 전체 지식 목록 (최신순) */
  findAll(): Promise<Knowledge[]>;
  update(id: string, input: UpdateKnowledgeInput): Promise<Knowledge>;
  delete(id: string): Promise<void>;
}

const REQUIRED_FIELDS = ["title", "content"] as const;

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function isValidCategory(value: unknown): boolean {
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value as string);
}

const CATEGORY_ERROR = `category는 다음 중 하나여야 합니다: ${KNOWLEDGE_CATEGORIES.join(", ")}`;

/** 생성 입력 검증 — 필수 필드(title/content) 공백 불가, category는 Enum 값만 허용 */
export function validateCreateKnowledge(
  input: Partial<CreateKnowledgeInput>,
): string[] {
  const errors = REQUIRED_FIELDS.filter((field) => isBlank(input[field])).map(
    (field) => `${field}은(는) 비어 있을 수 없습니다.`,
  );
  if (
    input.category !== undefined &&
    input.category !== null &&
    !isValidCategory(input.category)
  ) {
    errors.push(CATEGORY_ERROR);
  }
  return errors;
}

/** 수정 입력 검증 — 지정된 필수 필드는 공백 불가, category는 Enum 값만 허용 */
export function validateUpdateKnowledge(input: UpdateKnowledgeInput): string[] {
  const errors = REQUIRED_FIELDS.filter(
    (field) => input[field] !== undefined && isBlank(input[field]),
  ).map((field) => `${field}은(는) 비어 있을 수 없습니다.`);
  if (
    input.category !== undefined &&
    input.category !== null &&
    !isValidCategory(input.category)
  ) {
    errors.push(CATEGORY_ERROR);
  }
  return errors;
}

import { MEMORY_SCOPES } from "@acos/shared";
import type { MemoryScope } from "@acos/shared";

/**
 * Memory — Company Brain의 표준 구조화 저장소. (TASK-0402)
 * AI용 구조화 설정 저장소다 — 사람이 쓰는 메모·작업기록은 ProjectMemory가 담당한다.
 *
 * 프로젝트 메모 형태였던 구 Memory(ProjectMemory로 개칭·보존)와 달리,
 * scope/scopeId/key/value 기반의 **구조화 저장소**다. AI가 Company Brain을
 * 실제 사용할 때 참조하는 표준 Memory이며, 값은 JSON으로 저장되어
 * 문자열·숫자·객체 등 어떤 구조든 담을 수 있다.
 * 저장 방식은 MemoryStore Port 뒤에 숨는다 — Prisma 어댑터는 apps/api에 있다.
 * 자세한 구조: docs/architecture/memory.md
 */
export interface Memory {
  id: string;
  /** 적용 범위 — Enum 고정 (CTO 결정): GLOBAL/COMPANY/PROJECT/PRODUCT */
  scope: MemoryScope;
  /** 범위 대상 식별자 — PROJECT는 projectId, PRODUCT는 productId. GLOBAL/COMPANY는 null */
  scopeId: string | null;
  /** 범위 내 유니크 키 */
  key: string;
  /** 구조화 값 — JSON 직렬화 가능한 모든 값 */
  value: unknown;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemoryInput {
  scope: MemoryScope;
  scopeId?: string | null;
  key: string;
  value: unknown;
  description?: string | null;
}

/** 수정은 value/description만 — scope/scopeId/key는 식별자라 불변 */
export interface UpdateMemoryInput {
  value?: unknown;
  description?: string | null;
}

/** Structured Memory 저장소 Port — 인프라(Prisma 등)가 구현한다 */
export interface MemoryStore {
  create(input: CreateMemoryInput): Promise<Memory>;
  findById(id: string): Promise<Memory | null>;
  /** (scope, scopeId, key) 조합으로 단건 조회 — 중복 방지에 사용 */
  findByKey(
    scope: MemoryScope,
    scopeId: string | null,
    key: string,
  ): Promise<Memory | null>;
  /** scope/scopeId로 필터링한 목록 (최신순). 필터 미지정 시 전체 */
  findMany(filter: { scope?: MemoryScope; scopeId?: string | null }): Promise<
    Memory[]
  >;
  update(id: string, input: UpdateMemoryInput): Promise<Memory>;
  delete(id: string): Promise<void>;
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/** 대상 식별자(scopeId)가 필요한 범위 — 존재 검증은 인프라 계층이 수행한다 */
export const SCOPES_REQUIRING_ID: readonly MemoryScope[] = [
  "PROJECT",
  "PRODUCT",
];

/**
 * 생성 입력 검증 — scope는 Enum 값만, key 공백 불가, value 필수(모든 JSON 값 허용).
 * scope 규칙(CTO 결정): GLOBAL/COMPANY → scopeId 없음, PROJECT/PRODUCT → scopeId 필수.
 */
export function validateCreateMemory(
  input: Partial<CreateMemoryInput>,
): string[] {
  const errors: string[] = [];
  if (!(MEMORY_SCOPES as readonly string[]).includes(input.scope as string)) {
    errors.push(
      `scope는 다음 중 하나여야 합니다: ${MEMORY_SCOPES.join(", ")}`,
    );
  } else if (SCOPES_REQUIRING_ID.includes(input.scope as MemoryScope)) {
    if (isBlank(input.scopeId)) {
      errors.push(`scope=${input.scope}에는 scopeId가 필요합니다.`);
    }
  } else if (input.scopeId != null && !isBlank(input.scopeId)) {
    errors.push(`scope=${input.scope}에는 scopeId를 지정할 수 없습니다.`);
  }
  if (isBlank(input.key)) {
    errors.push("key은(는) 비어 있을 수 없습니다.");
  }
  if (input.value === undefined) {
    errors.push("value은(는) 필수입니다.");
  }
  return errors;
}

/** 수정 입력 검증 — 수정할 필드가 하나는 있어야 한다 */
export function validateUpdateMemory(input: UpdateMemoryInput): string[] {
  if (input.value === undefined && input.description === undefined) {
    return ["수정할 필드(value 또는 description)를 지정해야 합니다."];
  }
  return [];
}

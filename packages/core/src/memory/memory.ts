/**
 * Memory — 회사가 축적하는 기억 도메인. (TASK-0307, Company Brain 소속)
 *
 * 프로젝트 진행 중 얻은 지식 조각(기억)을 보존한다.
 * SOP(절차)·Decision Log(결정)와 나란히 Company Brain을 구성하며,
 * 저장 방식은 MemoryStore Port 뒤에 숨는다 — Prisma 어댑터는 apps/api에 있다.
 * 자세한 구조: docs/architecture/memory.md
 */
export interface Memory {
  id: string;
  projectId: string;
  title: string;
  /** 기억 본문 */
  content: string;
  /** 기억의 출처 (예: TASK, SOP 실행, 문서 — 선택) */
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemoryInput {
  projectId: string;
  title: string;
  content: string;
  source?: string | null;
}

export interface UpdateMemoryInput {
  title?: string;
  content?: string;
  source?: string | null;
}

/** Memory 저장소 Port — 인프라(Prisma 등)가 구현한다 */
export interface MemoryStore {
  create(input: CreateMemoryInput): Promise<Memory>;
  findById(id: string): Promise<Memory | null>;
  /** 프로젝트의 기억 목록 (최신순) */
  findByProjectId(projectId: string): Promise<Memory[]>;
  update(id: string, input: UpdateMemoryInput): Promise<Memory>;
  delete(id: string): Promise<void>;
}

const REQUIRED_FIELDS = ["title", "content"] as const;

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/** 생성 입력 검증 — 필수 필드(title/content) 공백 불가 */
export function validateCreateMemory(
  input: Partial<CreateMemoryInput>,
): string[] {
  return REQUIRED_FIELDS.filter((field) => isBlank(input[field])).map(
    (field) => `${field}은(는) 비어 있을 수 없습니다.`,
  );
}

/** 수정 입력 검증 — 지정된 필수 필드는 공백으로 바꿀 수 없다 */
export function validateUpdateMemory(input: UpdateMemoryInput): string[] {
  return REQUIRED_FIELDS.filter(
    (field) => input[field] !== undefined && isBlank(input[field]),
  ).map((field) => `${field}은(는) 비어 있을 수 없습니다.`);
}

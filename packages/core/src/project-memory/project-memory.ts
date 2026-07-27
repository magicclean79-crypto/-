/**
 * ProjectMemory — 프로젝트 메모형 기억 도메인. (구 Memory, TASK-0307)
 *
 * TASK-0402에서 표준 Memory가 구조화 저장소(scope/key/value)로 재정의되면서,
 * 기존 메모형 구현은 CTO 지시에 따라 ProjectMemory로 개칭해 데이터와 기능을
 * 보존한다. 프로젝트 진행 중 얻은 지식 조각(기억)을 자유 텍스트로 담는다.
 * 저장 방식은 ProjectMemoryStore Port 뒤에 숨는다 — Prisma 어댑터는 apps/api에 있다.
 * 자세한 구조: docs/architecture/memory.md
 */
export interface ProjectMemory {
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

export interface CreateProjectMemoryInput {
  projectId: string;
  title: string;
  content: string;
  source?: string | null;
}

export interface UpdateProjectMemoryInput {
  title?: string;
  content?: string;
  source?: string | null;
}

/** ProjectMemory 저장소 Port — 인프라(Prisma 등)가 구현한다 */
export interface ProjectMemoryStore {
  create(input: CreateProjectMemoryInput): Promise<ProjectMemory>;
  findById(id: string): Promise<ProjectMemory | null>;
  /** 프로젝트의 기억 목록 (최신순) */
  findByProjectId(projectId: string): Promise<ProjectMemory[]>;
  update(id: string, input: UpdateProjectMemoryInput): Promise<ProjectMemory>;
  delete(id: string): Promise<void>;
}

const REQUIRED_FIELDS = ["title", "content"] as const;

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/** 생성 입력 검증 — 필수 필드(title/content) 공백 불가 */
export function validateCreateProjectMemory(
  input: Partial<CreateProjectMemoryInput>,
): string[] {
  return REQUIRED_FIELDS.filter((field) => isBlank(input[field])).map(
    (field) => `${field}은(는) 비어 있을 수 없습니다.`,
  );
}

/** 수정 입력 검증 — 지정된 필수 필드는 공백으로 바꿀 수 없다 */
export function validateUpdateProjectMemory(input: UpdateProjectMemoryInput): string[] {
  return REQUIRED_FIELDS.filter(
    (field) => input[field] !== undefined && isBlank(input[field]),
  ).map((field) => `${field}은(는) 비어 있을 수 없습니다.`);
}

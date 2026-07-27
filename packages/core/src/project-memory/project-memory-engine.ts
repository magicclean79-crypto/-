import type {
  CreateProjectMemoryInput,
  ProjectMemory,
  ProjectMemoryStore,
  UpdateProjectMemoryInput,
} from "./project-memory";
import { validateCreateProjectMemory, validateUpdateProjectMemory } from "./project-memory";

/** 입력 검증 실패 — API 계층에서 400으로 매핑한다 */
export class ProjectMemoryValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "ProjectMemoryValidationError";
  }
}

/**
 * ProjectMemory Engine — 기억의 기록/회상을 담당하는 도메인 서비스. (TASK-0307)
 *
 * Company Brain 소속으로, Store Port 위에서 프레임워크와 무관하게 동작한다.
 * Workflow Engine(Execution Layer)은 이 엔진을 주입받아 **사용할 수 있지만
 * 소유하지 않는다** — 기억의 저장·수명 관리는 전적으로 Company Brain의 책임이다.
 * (실행 단계에 기억을 연결하는 것은 별도 스펙 수신 시 진행)
 */
export class ProjectMemoryEngine {
  constructor(private readonly store: ProjectMemoryStore) {}

  /** 기억을 기록한다 — 필수 필드 검증 + 트림 정규화 */
  async remember(input: CreateProjectMemoryInput): Promise<ProjectMemory> {
    const errors = validateCreateProjectMemory(input);
    if (errors.length > 0) {
      throw new ProjectMemoryValidationError(errors);
    }
    return this.store.create({
      projectId: input.projectId,
      title: input.title.trim(),
      content: input.content.trim(),
      source: input.source?.trim() || null,
    });
  }

  /** 프로젝트의 기억을 회상한다 (최신순) */
  async recall(projectId: string): Promise<ProjectMemory[]> {
    return this.store.findByProjectId(projectId);
  }

  async get(id: string): Promise<ProjectMemory | null> {
    return this.store.findById(id);
  }

  /** 기억을 고쳐 쓴다 — 지정한 필드만 변경 */
  async revise(id: string, input: UpdateProjectMemoryInput): Promise<ProjectMemory> {
    const errors = validateUpdateProjectMemory(input);
    if (errors.length > 0) {
      throw new ProjectMemoryValidationError(errors);
    }
    return this.store.update(id, {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content.trim() } : {}),
      ...(input.source !== undefined
        ? { source: input.source?.trim() || null }
        : {}),
    });
  }

  /** 기억을 지운다 */
  async forget(id: string): Promise<void> {
    await this.store.delete(id);
  }
}

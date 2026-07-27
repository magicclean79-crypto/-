import type { CreateProjectMemoryInput, ProjectMemory, UpdateProjectMemoryInput } from "@acos/core";

/** memories 테이블을 흉내 내는 인메모리 Store 목업 (테스트 전용) */
export function createStoreMock() {
  const memories = new Map<string, ProjectMemory>();
  let sequence = 0;

  return {
    memories,
    create: jest.fn(async (input: CreateProjectMemoryInput): Promise<ProjectMemory> => {
      const now = new Date(2026, 6, 27, 0, 0, ++sequence);
      const row: ProjectMemory = {
        id: `mem-${sequence}`,
        projectId: input.projectId,
        title: input.title,
        content: input.content,
        source: input.source ?? null,
        createdAt: now,
        updatedAt: now,
      };
      memories.set(row.id, row);
      return { ...row };
    }),
    findById: jest.fn(async (id: string) => {
      const row = memories.get(id);
      return row ? { ...row } : null;
    }),
    findByProjectId: jest.fn(async (projectId: string) =>
      [...memories.values()]
        .filter((row) => row.projectId === projectId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    ),
    update: jest.fn(
      async (id: string, input: UpdateProjectMemoryInput): Promise<ProjectMemory> => {
        const row = memories.get(id);
        if (!row) throw new Error(`memory not found: ${id}`);
        const updated = {
          ...row,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.source !== undefined ? { source: input.source } : {}),
          updatedAt: new Date(2026, 6, 27, 1, 0, ++sequence),
        } as ProjectMemory;
        memories.set(id, updated);
        return { ...updated };
      },
    ),
    delete: jest.fn(async (id: string) => {
      memories.delete(id);
    }),
  };
}

/** project.findUnique만 필요한 최소 Prisma 목업 — proj-1만 존재 */
export function createPrismaMock() {
  return {
    project: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "proj-1" ? { id: "proj-1" } : null,
      ),
    },
  };
}

export const validRequest = {
  title: "매트 상세페이지는 재질 표기가 필수",
  content: "PVC 매트 상세페이지 생성 시 재질/두께 속성이 있어야 반려되지 않는다.",
  source: "TASK-0303",
};

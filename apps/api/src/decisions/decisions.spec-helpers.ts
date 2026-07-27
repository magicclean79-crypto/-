import type { Decision } from "@acos/core";
import type {
  CreateDecisionInput,
  UpdateDecisionInput,
} from "@acos/core";

/** decisions 테이블 + project 조회를 흉내 내는 인메모리 목업 (테스트 전용) */
export function createRepositoryMock() {
  const decisions = new Map<string, Decision>();
  let sequence = 0;

  return {
    decisions,
    create: jest.fn(async (input: CreateDecisionInput): Promise<Decision> => {
      const now = new Date(2026, 6, 27, 0, 0, ++sequence);
      const row: Decision = {
        id: `dec-${sequence}`,
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? null,
        reason: input.reason,
        decisionType: input.decisionType,
        author: input.author,
        createdAt: now,
        updatedAt: now,
      };
      decisions.set(row.id, row);
      return { ...row };
    }),
    findById: jest.fn(async (id: string) => {
      const row = decisions.get(id);
      return row ? { ...row } : null;
    }),
    findByProjectId: jest.fn(async (projectId: string) =>
      [...decisions.values()]
        .filter((row) => row.projectId === projectId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    ),
    update: jest.fn(
      async (id: string, input: UpdateDecisionInput): Promise<Decision> => {
        const row = decisions.get(id);
        if (!row) throw new Error(`decision not found: ${id}`);
        const updated: Decision = {
          ...row,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.decisionType !== undefined
            ? { decisionType: input.decisionType }
            : {}),
          ...(input.author !== undefined ? { author: input.author } : {}),
          updatedAt: new Date(2026, 6, 27, 1, 0, ++sequence),
        };
        decisions.set(id, updated);
        return { ...updated };
      },
    ),
    delete: jest.fn(async (id: string) => {
      decisions.delete(id);
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
  title: "Project를 루트 엔티티로 도입",
  description: "여러 상품/버전을 묶는 작업 단위",
  reason: "상품 단위 projectId 임시 구조의 한계 해소",
  decisionType: "ARCHITECTURE",
  author: "CTO",
} as const;

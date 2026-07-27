import type { CreateMemoryInput, Memory, UpdateMemoryInput } from "@acos/core";

/** 표준 Structured Memory 저장소를 흉내 내는 인메모리 목업 (테스트 전용) */
export function createStoreMock() {
  const memories = new Map<string, Memory>();
  let sequence = 0;

  return {
    memories,
    create: jest.fn(async (input: CreateMemoryInput): Promise<Memory> => {
      const now = new Date(2026, 6, 27, 0, 0, ++sequence);
      const row: Memory = {
        id: `mem-${sequence}`,
        scope: input.scope,
        scopeId: input.scopeId ?? null,
        key: input.key,
        value: input.value,
        description: input.description ?? null,
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
    findByKey: jest.fn(
      async (scope: string, scopeId: string | null, key: string) => {
        const row = [...memories.values()].find(
          (item) =>
            item.scope === scope &&
            item.scopeId === scopeId &&
            item.key === key,
        );
        return row ? { ...row } : null;
      },
    ),
    findMany: jest.fn(
      async (filter: { scope?: string; scopeId?: string | null }) =>
        [...memories.values()]
          .filter(
            (item) =>
              (filter.scope === undefined || item.scope === filter.scope) &&
              (filter.scopeId === undefined ||
                item.scopeId === filter.scopeId),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    ),
    update: jest.fn(
      async (id: string, input: UpdateMemoryInput): Promise<Memory> => {
        const row = memories.get(id);
        if (!row) throw new Error(`memory not found: ${id}`);
        const updated: Memory = {
          ...row,
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          updatedAt: new Date(2026, 6, 27, 1, 0, ++sequence),
        };
        memories.set(id, updated);
        return { ...updated };
      },
    ),
    delete: jest.fn(async (id: string) => {
      memories.delete(id);
    }),
  };
}

/** project/product 존재 확인만 필요한 최소 Prisma 목업 — proj-1/prod-1만 존재 */
export function createPrismaMock() {
  return {
    project: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "proj-1" || where.id === "proj-2"
          ? { id: where.id }
          : null,
      ),
    },
    product: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "prod-1" ? { id: "prod-1" } : null,
      ),
    },
  };
}

export const validRequest = {
  scope: "PROJECT",
  scopeId: "proj-1",
  key: "preferred-tone",
  value: { tone: "친근함", emoji: false },
  description: "상세페이지 문체 설정",
} as const;

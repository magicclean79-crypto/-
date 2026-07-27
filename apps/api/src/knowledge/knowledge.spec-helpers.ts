import type {
  CreateKnowledgeInput,
  Knowledge,
  UpdateKnowledgeInput,
} from "@acos/core";

/** knowledge 테이블을 흉내 내는 인메모리 목업 (테스트 전용) */
export function createRepositoryMock() {
  const items = new Map<string, Knowledge>();
  let sequence = 0;

  return {
    items,
    create: jest.fn(async (input: CreateKnowledgeInput): Promise<Knowledge> => {
      const now = new Date(2026, 6, 27, 0, 0, ++sequence);
      const row: Knowledge = {
        id: `kn-${sequence}`,
        title: input.title,
        content: input.content,
        category: input.category ?? null,
        createdAt: now,
        updatedAt: now,
      };
      items.set(row.id, row);
      return { ...row };
    }),
    findById: jest.fn(async (id: string) => {
      const row = items.get(id);
      return row ? { ...row } : null;
    }),
    findAll: jest.fn(async () =>
      [...items.values()].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    ),
    update: jest.fn(
      async (id: string, input: UpdateKnowledgeInput): Promise<Knowledge> => {
        const row = items.get(id);
        if (!row) throw new Error(`knowledge not found: ${id}`);
        const updated = {
          ...row,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          updatedAt: new Date(2026, 6, 27, 1, 0, ++sequence),
        } as Knowledge;
        items.set(id, updated);
        return { ...updated };
      },
    ),
    delete: jest.fn(async (id: string) => {
      items.delete(id);
    }),
  };
}

export const validRequest = {
  title: "상세페이지 금지어",
  content: "최상급 표현(최고, 1위, 유일)은 근거 자료 없이 사용할 수 없다.",
  category: "금지어",
};

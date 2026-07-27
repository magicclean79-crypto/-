import type { Memory, MemoryStore } from "./memory";
import { MemoryEngine, MemoryValidationError } from "./memory-engine";

function createStoreMock() {
  const memories = new Map<string, Memory>();
  let sequence = 0;
  const store: MemoryStore = {
    async create(input) {
      const now = new Date(2026, 6, 27, 0, 0, ++sequence);
      const row: Memory = {
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
    },
    async findById(id) {
      const row = memories.get(id);
      return row ? { ...row } : null;
    },
    async findByProjectId(projectId) {
      return [...memories.values()]
        .filter((row) => row.projectId === projectId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async update(id, input) {
      const row = memories.get(id);
      if (!row) throw new Error(`memory not found: ${id}`);
      const updated = { ...row, ...input, updatedAt: new Date() } as Memory;
      memories.set(id, updated);
      return { ...updated };
    },
    async delete(id) {
      memories.delete(id);
    },
  };
  return store;
}

describe("MemoryEngine", () => {
  const valid = {
    projectId: "proj-1",
    title: "매트 상세페이지는 재질 표기가 필수",
    content: "PVC 매트 상세페이지 생성 시 재질/두께 속성이 있어야 반려되지 않는다.",
    source: "TASK-0303",
  };

  it("remember — 기억을 기록한다 (트림, source 미지정 시 null)", async () => {
    const engine = new MemoryEngine(createStoreMock());

    const memory = await engine.remember({
      ...valid,
      title: `  ${valid.title}  `,
    });
    expect(memory.title).toBe(valid.title);
    expect(memory.source).toBe("TASK-0303");

    const minimal = await engine.remember({ ...valid, source: undefined });
    expect(minimal.source).toBeNull();
  });

  it("remember — 필수 필드(title/content) 공백이면 MemoryValidationError", async () => {
    const engine = new MemoryEngine(createStoreMock());

    await expect(
      engine.remember({ ...valid, title: " " }),
    ).rejects.toBeInstanceOf(MemoryValidationError);
    await expect(
      engine.remember({ ...valid, content: "" }),
    ).rejects.toBeInstanceOf(MemoryValidationError);
  });

  it("recall — 프로젝트의 기억을 최신순으로 회상한다", async () => {
    const engine = new MemoryEngine(createStoreMock());
    const first = await engine.remember(valid);
    const second = await engine.remember({ ...valid, title: "두 번째 기억" });
    await engine.remember({ ...valid, projectId: "other" });

    const recalled = await engine.recall("proj-1");
    expect(recalled.map((memory) => memory.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("revise/forget — 지정 필드만 고쳐 쓰고, 지운 기억은 회상되지 않는다", async () => {
    const engine = new MemoryEngine(createStoreMock());
    const memory = await engine.remember(valid);

    const revised = await engine.revise(memory.id, { source: null });
    expect(revised.source).toBeNull();
    expect(revised.title).toBe(valid.title);

    await expect(
      engine.revise(memory.id, { content: " " }),
    ).rejects.toBeInstanceOf(MemoryValidationError);

    await engine.forget(memory.id);
    expect(await engine.get(memory.id)).toBeNull();
    expect(await engine.recall("proj-1")).toHaveLength(0);
  });
});

/**
 * memory/knowledge/decision findMany를 흉내 내는 최소 Prisma 목업 (테스트 전용).
 * where 조건 해석은 하지 않고 준비된 rows를 반환하되, 호출 인자를 기록한다 —
 * 검색 조건 조립은 호출 인자 검증으로, SOP 매칭은 실제 로직으로 확인한다.
 */
export function createPrismaMock(rows?: {
  memories?: unknown[];
  knowledge?: unknown[];
  decisions?: unknown[];
}) {
  const now = new Date(2026, 6, 27);
  const base = { createdAt: now, updatedAt: now };

  return {
    memory: {
      findMany: jest.fn(async () =>
        rows?.memories ?? [
          {
            id: "mem-1",
            scope: "GLOBAL",
            scopeId: null,
            key: "banned-words",
            value: ["최고", "1위"],
            description: "금지어 목록",
            ...base,
          },
        ],
      ),
    },
    knowledge: {
      findMany: jest.fn(async () =>
        rows?.knowledge ?? [
          {
            id: "kn-1",
            title: "상세페이지 금지어",
            content: "최상급 표현 금지",
            category: "RULE",
            ...base,
          },
        ],
      ),
    },
    decision: {
      findMany: jest.fn(async () =>
        rows?.decisions ?? [
          {
            id: "dec-1",
            projectId: "proj-1",
            title: "금지어 정책 도입",
            description: null,
            reason: "법적 리스크 축소",
            decisionType: "POLICY",
            author: "CTO",
            ...base,
          },
        ],
      ),
    },
  };
}

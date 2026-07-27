import type { CompanyBrainQueryRequest } from "@acos/shared";
import type { ProductObject } from "@prisma/client";

/** project/productObject 조회를 흉내 내는 최소 Prisma 목업 (테스트 전용) */
export function createPrismaMock(productObjects: Partial<ProductObject>[]) {
  return {
    project: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "proj-1" ? { id: "proj-1" } : null,
      ),
    },
    productObject: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { projectId: string; version?: number };
        }) => {
          const matches = productObjects
            .filter(
              (po) =>
                po.projectId === where.projectId &&
                (where.version === undefined || po.version === where.version),
            )
            .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
          return matches[0] ? { ...matches[0] } : null;
        },
      ),
    },
  };
}

/**
 * CompanyBrainService 목업 — 호출된 query에 따라 준비된 섹션을 돌려준다.
 * bannedWords: GLOBAL Memory(banned-words) value로 반환할 값 (undefined면 미설정)
 */
export function createCompanyBrainMock(options?: {
  bannedWords?: unknown;
  ruleKnowledge?: { title: string; category: string | null }[];
  decisions?: { title: string }[];
  hasSop?: boolean;
}) {
  const hasSop = options?.hasSop ?? true;
  return {
    query: jest.fn(async (request: CompanyBrainQueryRequest) => {
      const memoryItems =
        request.query === "banned-words" && options?.bannedWords !== undefined
          ? [
              {
                id: "mem-1",
                scope: "GLOBAL",
                scopeId: null,
                key: "banned-words",
                value: options.bannedWords,
                description: null,
                createdAt: "",
                updatedAt: "",
              },
            ]
          : [];
      return {
        query: request.query,
        results: [
          { source: "MEMORY", items: memoryItems },
          {
            source: "KNOWLEDGE",
            items: (options?.ruleKnowledge ?? []).map((rule, index) => ({
              id: `kn-${index}`,
              title: rule.title,
              content: "",
              category: rule.category,
              createdAt: "",
              updatedAt: "",
            })),
          },
          {
            source: "DECISION",
            items: (options?.decisions ?? []).map((decision, index) => ({
              id: `dec-${index}`,
              projectId: "proj-1",
              title: decision.title,
              description: null,
              reason: "",
              decisionType: "PROCESS",
              author: "CTO",
              createdAt: "",
              updatedAt: "",
            })),
          },
          {
            source: "SOP",
            items: hasSop
              ? [
                  {
                    key: "product-content",
                    name: "상품 콘텐츠 표준 절차",
                    description: "",
                    steps: [],
                  },
                ]
              : [],
          },
        ],
      };
    }),
  };
}

export const draftProductObject: Partial<ProductObject> = {
  id: "po-1",
  projectId: "proj-1",
  version: 3,
  status: "DRAFT",
  title: "Magic Clean PVC Mat",
  brand: null,
  category: "생활용품",
  ocrSummary: {
    sources: [],
    combinedText: "Magic Clean PVC Mat 60x90",
    averageConfidence: 0.9,
  },
  visionSummary: null,
};

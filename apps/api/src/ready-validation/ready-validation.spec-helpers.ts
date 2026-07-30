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
 * CompanyBrainService 목업은 **거버넌스 모듈이 소유한다** (TASK-2501) —
 * READY 판정과 발행 게이트가 같은 규칙을 읽으므로 목업도 같은 것을 쓴다.
 */
export { createCompanyBrainMock } from "../content-governance/governance.spec-helpers";

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

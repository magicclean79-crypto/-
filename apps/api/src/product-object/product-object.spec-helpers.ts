import type { ProductObject } from "@prisma/client";

/** product_objects 테이블을 흉내 내는 인메모리 Prisma 목업 (테스트 전용) */
export function createPrismaMock() {
  const rows = new Map<string, ProductObject>();
  let sequence = 0;

  const prisma = {
    rows,
    project: {
      findUnique: jest.fn(),
    },
    productObject: {
      create: jest.fn(async ({ data }: { data: Partial<ProductObject> }) => {
        const now = new Date();
        const row = {
          id: `po-${++sequence}`,
          status: "DRAFT",
          brand: null,
          category: null,
          attributes: null,
          ocrSummary: null,
          visionSummary: null,
          metadata: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        } as ProductObject;
        rows.set(row.id, row);
        return { ...row };
      }),
      findFirst: jest.fn(
        async ({
          where,
          select,
        }: {
          where: { projectId: string; version?: number };
          select?: { version: true };
        }) => {
          const matches = [...rows.values()]
            .filter(
              (row) =>
                row.projectId === where.projectId &&
                (where.version === undefined || row.version === where.version),
            )
            .sort((a, b) => b.version - a.version);
          const found = matches[0];
          if (!found) return null;
          return select ? { version: found.version } : { ...found };
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where: { projectId: string } }) =>
          [...rows.values()]
            .filter((row) => row.projectId === where.projectId)
            .sort((a, b) => b.version - a.version),
      ),
    },
  };
  return prisma;
}

export const projectWithOcr = {
  id: "proj-1",
  name: "매직클린 걸레",
  description: null,
  products: [
    {
      id: "prod-1",
      images: [
        {
          id: "img-1",
          key: "images/a.png",
          mimeType: "image/png",
          ocrResults: [
            {
              extractedText: "Magic Clean PVC Mat\n49000 KRW",
              confidence: 0.94,
            },
          ],
        },
      ],
    },
    {
      id: "prod-2",
      images: [
        {
          id: "img-2",
          key: "images/b.png",
          mimeType: "image/png",
          ocrResults: [],
        },
      ],
    },
  ],
};

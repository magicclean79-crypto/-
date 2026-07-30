import type {
  Content,
  ContentGovernanceCheck,
  ContentStatusHistory,
  ProductObject,
} from "@prisma/client";

/**
 * contents/product_objects를 흉내 내는 인메모리 Prisma 목업 (테스트 전용).
 *
 * 연결된 Product Object는 **실제 서비스가 select하는 필드 그대로**
 * (`version`·`status`·`category`) 돌려준다 — `version`만 돌려주면 분류별
 * 필수 고지 판정이 구조적으로 검증될 수 없다 (TASK-2501).
 */
export function createPrismaMock() {
  const contents = new Map<string, Content>();
  const productObjects: Partial<ProductObject>[] = [];
  const statusHistory: ContentStatusHistory[] = [];
  const governanceChecks: ContentGovernanceCheck[] = [];
  let sequence = 0;

  /** 실제 서비스의 select와 같은 모양 */
  const linkedObject = (productObjectId: string | null) => {
    const po = productObjects.find((item) => item.id === productObjectId);
    return po
      ? {
          version: po.version as number,
          status: po.status as string,
          category: (po.category ?? null) as string | null,
        }
      : null;
  };

  const prisma = {
    contents,
    productObjects,
    statusHistory,
    governanceChecks,
    $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    contentGovernanceCheck: {
      create: jest.fn(
        async ({ data }: { data: Partial<ContentGovernanceCheck> }) => {
          const row = {
            id: `gov-${governanceChecks.length + 1}`,
            createdAt: new Date(),
            published: false,
            actor: null,
            ...data,
          } as ContentGovernanceCheck;
          governanceChecks.push(row);
          return { ...row };
        },
      ),
      findMany: jest.fn(
        async ({
          where,
          take,
        }: {
          where: { contentId: string };
          take?: number;
        }) => {
          const rows = governanceChecks
            .filter((row) => row.contentId === where.contentId)
            .slice()
            .reverse();
          return (typeof take === "number" ? rows.slice(0, take) : rows).map(
            (row) => ({ ...row }),
          );
        },
      ),
    },
    contentStatusHistory: {
      create: jest.fn(
        async ({ data }: { data: Partial<ContentStatusHistory> }) => {
          const row = {
            id: `hist-${statusHistory.length + 1}`,
            createdAt: new Date(),
            ...data,
          } as ContentStatusHistory;
          statusHistory.push(row);
          return { ...row };
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where: { contentId: string } }) =>
          statusHistory
            .filter((row) => row.contentId === where.contentId)
            .slice()
            .reverse(),
      ),
    },
    project: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "proj-1"
          ? {
              id: "proj-1",
              name: "매직클린",
              description: "물만으로 닦는다",
            }
          : null,
      ),
    },
    productObject: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { projectId: string; version?: number; status?: string };
        }) => {
          const matches = productObjects
            .filter(
              (po) =>
                po.projectId === where.projectId &&
                (where.version === undefined || po.version === where.version) &&
                (where.status === undefined || po.status === where.status),
            )
            .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
          return matches[0] ? { ...matches[0] } : null;
        },
      ),
    },
    content: {
      create: jest.fn(
        async ({ data }: { data: Partial<Content> }) => {
          const now = new Date();
          const row = {
            id: `content-${++sequence}`,
            status: "DRAFT",
            publishedAt: null,
            createdAt: now,
            updatedAt: now,
            ...data,
          } as Content;
          contents.set(row.id, row);
          return { ...row, productObject: linkedObject(row.productObjectId) };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Content>;
        }) => {
          const row = contents.get(where.id) as Content;
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row, productObject: linkedObject(row.productObjectId) };
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where: { projectId: string } }) =>
          [...contents.values()]
            .filter((row) => row.projectId === where.projectId)
            .map((row) => ({
              ...row,
              productObject: linkedObject(row.productObjectId),
            })),
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id: string; projectId: string };
        }) => {
          const row = contents.get(where.id);
          if (!row || row.projectId !== where.projectId) return null;
          return { ...row, productObject: linkedObject(row.productObjectId) };
        },
      ),
    },
  };
  return prisma;
}

export const readyProductObject: Partial<ProductObject> = {
  id: "po-1",
  projectId: "proj-1",
  version: 2,
  status: "READY",
  title: "Magic Clean PVC Mat",
  brand: null,
  category: "생활용품",
  attributes: { 재질: "PVC" },
  ocrSummary: {
    sources: [],
    combinedText: "Magic Clean PVC Mat",
    averageConfidence: 0.9,
  },
  visionSummary: null,
};

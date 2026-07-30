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
  /**
   * 예약 스캔 실행 기록 (TASK-2701) — `where.scope`를 실제로 적용한다:
   * 무시하면 범위별 비교(전체/프로젝트)가 구조적으로 검증되지 않는다.
   */
  const governanceScanRuns: Record<string, unknown>[] = [];
  /**
   * 프로젝트 — 예약 스캔이 프로젝트별로 돌기 위해 목록을 읽는다 (TASK-2801).
   * 테스트가 `prisma.projects.push(...)`로 늘릴 수 있다.
   */
  const projects: { id: string; name: string; description: string | null }[] = [
    { id: "proj-1", name: "매직클린", description: "물만으로 닦는다" },
    { id: "proj-2", name: "매직클린 프로", description: null },
  ];
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
    governanceScanRuns,
    $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    governanceScanRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `scan-${governanceScanRuns.length + 1}`,
          createdAt: new Date(),
          alerted: false,
          previousTotal: null,
          ...data,
        };
        governanceScanRuns.push(row);
        return { ...row };
      }),
      findFirst: jest.fn(async (args?: { where?: { scope?: string } }) => {
        const scope = args?.where?.scope;
        const rows = governanceScanRuns.filter(
          (row) => scope === undefined || row.scope === scope,
        );
        const found = rows[rows.length - 1];
        return found ? { ...found } : null;
      }),
      findMany: jest.fn(
        async (args?: { where?: { scope?: string }; take?: number }) => {
          const scope = args?.where?.scope;
          let rows = governanceScanRuns.filter(
            (row) => scope === undefined || row.scope === scope,
          );
          rows = rows.slice().reverse();
          if (typeof args?.take === "number") {
            rows = rows.slice(0, args.take);
          }
          return rows.map((row) => ({ ...row }));
        },
      ),
    },
    contentGovernanceCheck: {
      create: jest.fn(
        async ({ data }: { data: Partial<ContentGovernanceCheck> }) => {
          const row = {
            id: `gov-${governanceChecks.length + 1}`,
            createdAt: new Date(),
            published: false,
            actor: null,
            archivedAt: null,
            ...data,
          } as ContentGovernanceCheck;
          governanceChecks.push(row);
          return { ...row };
        },
      ),
      /**
       * `where.archivedAt`를 **실제로 적용한다** (TASK-2601) — 무시하면
       * "보관된 것은 현황에서 비켜 둔다"가 구조적으로 검증되지 않는다.
       */
      findMany: jest.fn(
        async ({
          where,
          take,
        }: {
          where: { contentId: string; archivedAt?: null };
          take?: number;
        }) => {
          let rows = governanceChecks.filter(
            (row) => row.contentId === where.contentId,
          );
          if (where.archivedAt === null) {
            rows = rows.filter((row) => row.archivedAt === null);
          }
          rows = rows.slice().reverse();
          return (typeof take === "number" ? rows.slice(0, take) : rows).map(
            (row) => ({ ...row }),
          );
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { archivedAt: null; createdAt: { lte: Date } };
          data: { archivedAt: Date };
        }) => {
          let count = 0;
          for (const row of governanceChecks) {
            if (
              row.archivedAt === null &&
              row.createdAt <= where.createdAt.lte
            ) {
              row.archivedAt = data.archivedAt;
              count += 1;
            }
          }
          return { count };
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
    projects,
    project: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const found = projects.find((project) => project.id === where.id);
        return found ? { ...found } : null;
      }),
      /**
       * 예약 스캔이 프로젝트를 하나씩 훑기 위해 부른다 (TASK-2801).
       *
       * **목록을 실제로 돌려준다** — 빈 배열을 돌려주면 프로젝트별 스캔이
       * 아무것도 하지 않는데 테스트는 통과한다.
       */
      findMany: jest.fn(async () => projects.map((project) => ({ ...project }))),
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
            lastPublishedAt: null,
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
      /**
       * `projectId`·`status`·`take`·**커서와 정렬**을 실제로 적용한다
       * (TASK-2601 → TASK-2801).
       *
       * 무시하면 Preflight의 범위(프로젝트/전체)와 상태 필터가 구조적으로
       * 검증되지 않는다 — 스텁이 결함을 감추는 그 형태다. 커서를 무시하면
       * **묶음보다 큰 스캔이 영원히 첫 묶음만 다시 읽는데도** 테스트는
       * 통과한다(그 경우 실제로는 무한 루프다).
       */
      findMany: jest.fn(
        async (args?: {
          where?: {
            projectId?: string;
            status?: { in: string[] };
            OR?: {
              createdAt?: Date | { lt: Date };
              id?: { gt: string };
            }[];
          };
          orderBy?: unknown;
          take?: number;
        }) => {
          let rows = [...contents.values()];
          const projectId = args?.where?.projectId;
          if (projectId !== undefined) {
            rows = rows.filter((row) => row.projectId === projectId);
          }
          const statuses = args?.where?.status?.in;
          if (statuses) {
            rows = rows.filter((row) => statuses.includes(row.status));
          }

          // 실제 질의와 같은 정렬: createdAt 내림차순 + id 오름차순
          rows.sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              a.id.localeCompare(b.id),
          );

          // 커서: `createdAt < c` 또는 (`createdAt = c` 그리고 `id > c.id`)
          const cursor = args?.where?.OR;
          if (cursor) {
            rows = rows.filter((row) =>
              cursor.some((clause) => {
                if (
                  clause.createdAt !== undefined &&
                  typeof clause.createdAt === "object" &&
                  "lt" in clause.createdAt
                ) {
                  return row.createdAt.getTime() < clause.createdAt.lt.getTime();
                }
                if (
                  clause.createdAt instanceof Date &&
                  clause.id?.gt !== undefined
                ) {
                  return (
                    row.createdAt.getTime() === clause.createdAt.getTime() &&
                    row.id > clause.id.gt
                  );
                }
                return false;
              }),
            );
          }

          if (typeof args?.take === "number") {
            rows = rows.slice(0, args.take);
          }
          return rows.map((row) => ({
            ...row,
            productObject: linkedObject(row.productObjectId),
          }));
        },
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

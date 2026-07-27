import { BadRequestException } from "@nestjs/common";
import type { SopRun } from "@prisma/client";
import { ContentsService } from "../contents/contents.service";
import { OcrService } from "../ocr/ocr.service";
import { ProductObjectService } from "../product-object/product-object.service";

/** sop_runs + project 조회를 흉내 내는 인메모리 Prisma 목업 (테스트 전용) */
export function createPrismaMock() {
  const sopRuns = new Map<string, SopRun>();
  let sequence = 0;

  const prisma = {
    sopRuns,
    project: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "proj-1"
          ? {
              id: "proj-1",
              name: "매직클린",
              description: null,
              products: [
                { images: [{ id: "img-1" }, { id: "img-2" }] },
                { images: [{ id: "img-3" }] },
              ],
            }
          : null,
      ),
    },
    sopRun: {
      create: jest.fn(async ({ data }: { data: Partial<SopRun> }) => {
        const now = new Date();
        const row = {
          id: `run-${++sequence}`,
          status: "RUNNING",
          startedAt: now,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        } as SopRun;
        sopRuns.set(row.id, row);
        return { ...row };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<SopRun>;
        }) => {
          const row = sopRuns.get(where.id);
          if (!row) throw new Error(`sopRun not found: ${where.id}`);
          const updated = { ...row, ...data, updatedAt: new Date() } as SopRun;
          sopRuns.set(where.id, updated);
          return { ...updated };
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where: { projectId: string } }) =>
          [...sopRuns.values()]
            .filter((row) => row.projectId === where.projectId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; projectId: string } }) => {
          const row = sopRuns.get(where.id);
          return row && row.projectId === where.projectId ? { ...row } : null;
        },
      ),
    },
  };
  return prisma;
}

/** 기존 서비스(OCR/Product Object/Contents)를 흉내 내는 단계 실행자 목업 */
export function createServiceMocks() {
  const ocr = {
    runOcr: jest.fn(async (imageId: string) => ({
      id: `ocr-${imageId}`,
      imageId,
      status: "SUCCESS",
      confidence: 0.9,
    })),
  } as unknown as jest.Mocked<OcrService>;

  const productObject = {
    buildAndCreate: jest.fn(async (projectId: string) => ({
      id: "po-1",
      projectId,
      version: 4,
      status: "DRAFT",
      title: "Magic Clean PVC Mat",
    })),
    updateStatus: jest.fn(
      async (_projectId: string, version: number, status: string) => ({
        id: "po-1",
        version,
        status,
      }),
    ),
  } as unknown as jest.Mocked<ProductObjectService>;

  const contents = {
    generate: jest.fn(
      async (
        projectId: string,
        request: { productObjectVersion?: number },
      ) => ({
        id: "content-1",
        projectId,
        title: "Magic Clean PVC Mat 상세페이지",
        productObjectVersion: request.productObjectVersion ?? null,
      }),
    ),
  } as unknown as jest.Mocked<ContentsService>;

  return { ocr, productObject, contents };
}

/** READY 검수 실패를 흉내 낸다 (필수 조건 미충족) */
export function makeReadyFail(mocks: ReturnType<typeof createServiceMocks>) {
  mocks.productObject.updateStatus.mockRejectedValue(
    new BadRequestException("READY 전환 조건을 충족하지 않습니다: 제목 없음"),
  );
}

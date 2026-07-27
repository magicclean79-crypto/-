import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ProductObjectService } from "./product-object.service";
import {
  createPrismaMock,
  projectWithOcr,
} from "./product-object.spec-helpers";

describe("ProductObjectService (Service Test)", () => {
  async function createService(prisma: ReturnType<typeof createPrismaMock>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductObjectService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return moduleRef.get(ProductObjectService);
  }

  it("OCR + Vision(mock)을 조립해 v1 Product Object를 생성한다", async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue(projectWithOcr);
    const service = await createService(prisma);

    const result = await service.buildAndCreate("proj-1");

    expect(result.version).toBe(1);
    expect(result.status).toBe("DRAFT");
    expect(result.title).toBe("매직클린 걸레"); // vision.suggestedTitle 우선
    expect(result.category).toBe("생활용품");
    expect(result.ocrSummary?.sources).toHaveLength(1);
    expect(result.ocrSummary?.averageConfidence).toBe(0.94);
    expect(result.visionSummary?.source).toBe("mock");
    expect(result.metadata?.imageCount).toBe(2);
  });

  it("재생성하면 버전이 증가한다 (1:N 이력)", async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue(projectWithOcr);
    const service = await createService(prisma);

    const first = await service.buildAndCreate("proj-1");
    const second = await service.buildAndCreate("proj-1");

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(prisma.rows.size).toBe(2);
  });

  it("최신 버전을 조회하고 ?version으로 과거 버전도 조회한다", async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue(projectWithOcr);
    const service = await createService(prisma);
    await service.buildAndCreate("proj-1");
    await service.buildAndCreate("proj-1");

    expect((await service.getByProjectId("proj-1")).version).toBe(2);
    expect((await service.getByProjectId("proj-1", 1)).version).toBe(1);
    await expect(service.getByProjectId("proj-1", 9)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("존재하지 않는 프로젝트는 404를 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue(null);
    const service = await createService(prisma);

    await expect(service.buildAndCreate("nope")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("Product Object가 없으면 조회 시 404를 던진다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    await expect(service.getByProjectId("proj-1")).rejects.toThrow(
      NotFoundException,
    );
  });
});

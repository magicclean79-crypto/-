import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockContentGenerator } from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";
import { CONTENT_GENERATOR } from "./contents.constants";
import { ContentsService } from "./contents.service";
import {
  createPrismaMock,
  readyProductObject,
} from "./contents.spec-helpers";

describe("ContentsService (Service Test)", () => {
  async function createService(prisma: ReturnType<typeof createPrismaMock>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CONTENT_GENERATOR, useValue: new MockContentGenerator() },
      ],
    }).compile();
    return moduleRef.get(ContentsService);
  }

  it("최신 READY Product Object로 상세페이지를 생성한다", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const service = await createService(prisma);

    const content = await service.generate("proj-1", {});

    expect(content.status).toBe("DRAFT");
    expect(content.productObjectVersion).toBe(2);
    expect(content.title).toBe("Magic Clean PVC Mat 상세페이지");
    expect(content.body).toContain("# Magic Clean PVC Mat");
    expect(content.body).toContain("| 재질 | PVC |");
  });

  it("READY Product Object가 없으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({
      ...readyProductObject,
      status: "DRAFT",
    });
    const service = await createService(prisma);

    await expect(service.generate("proj-1", {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it("버전 지정: READY가 아니면 400, 없으면 404", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push(
      { ...readyProductObject, version: 1, status: "DRAFT", id: "po-d" },
      { ...readyProductObject },
    );
    const service = await createService(prisma);

    const content = await service.generate("proj-1", {
      productObjectVersion: 2,
    });
    expect(content.productObjectVersion).toBe(2);

    await expect(
      service.generate("proj-1", { productObjectVersion: 1 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.generate("proj-1", { productObjectVersion: 9 }),
    ).rejects.toThrow(NotFoundException);
  });

  it("없는 프로젝트는 404, 목록/단건 조회 동작", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const service = await createService(prisma);

    await expect(service.generate("nope", {})).rejects.toThrow(
      NotFoundException,
    );

    const created = await service.generate("proj-1", {});
    expect(await service.list("proj-1")).toHaveLength(1);
    expect((await service.getById("proj-1", created.id)).id).toBe(created.id);
    await expect(service.getById("proj-1", "nope")).rejects.toThrow(
      NotFoundException,
    );
  });
});

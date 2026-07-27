import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ContentsService } from "../contents/contents.service";
import { OcrService } from "../ocr/ocr.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProductObjectService } from "../product-object/product-object.service";
import { SopService } from "./sop.service";
import {
  createPrismaMock,
  createServiceMocks,
  makeReadyFail,
} from "./sop.spec-helpers";

describe("SopService (Service Test)", () => {
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    mocks: ReturnType<typeof createServiceMocks>,
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SopService,
        { provide: PrismaService, useValue: prisma },
        { provide: OcrService, useValue: mocks.ocr },
        { provide: ProductObjectService, useValue: mocks.productObject },
        { provide: ContentsService, useValue: mocks.contents },
      ],
    }).compile();
    return moduleRef.get(SopService);
  }

  it("기본 SOP 4단계를 순서대로 실행하고 DONE 이력을 남긴다", async () => {
    const prisma = createPrismaMock();
    const mocks = createServiceMocks();
    const service = await createService(prisma, mocks);

    const run = await service.run("proj-1");

    expect(run.sopKey).toBe("product-content");
    expect(run.status).toBe("DONE");
    expect(run.completedAt).not.toBeNull();
    expect(run.steps.map((step) => step.key)).toEqual([
      "ocr",
      "assemble",
      "ready",
      "content",
    ]);
    expect(run.steps.every((step) => step.status === "DONE")).toBe(true);

    // OCR: 프로젝트 전체 이미지(상품 2개, 3장)에 대해 실행
    expect(mocks.ocr.runOcr).toHaveBeenCalledTimes(3);
    expect(run.steps[0].output).toMatchObject({
      imageCount: 3,
      successCount: 3,
    });

    // 조립 → READY → 상세페이지가 같은 버전으로 연결된다 (단계 간 출력 전달)
    expect(run.steps[1].output).toMatchObject({ version: 4 });
    expect(mocks.productObject.updateStatus).toHaveBeenCalledWith(
      "proj-1",
      4,
      "READY",
    );
    expect(mocks.contents.generate).toHaveBeenCalledWith("proj-1", {
      productObjectVersion: 4,
    });
    expect(run.steps[3].output).toMatchObject({ productObjectVersion: 4 });
  });

  it("READY 검수 실패 시 ready FAILED, content SKIPPED, 실행 FAILED 이력", async () => {
    const prisma = createPrismaMock();
    const mocks = createServiceMocks();
    makeReadyFail(mocks);
    const service = await createService(prisma, mocks);

    const run = await service.run("proj-1");

    expect(run.status).toBe("FAILED");
    expect(run.steps.map((step) => step.status)).toEqual([
      "DONE",
      "DONE",
      "FAILED",
      "SKIPPED",
    ]);
    expect(run.steps[2].error).toContain("READY 전환 조건");
    expect(mocks.contents.generate).not.toHaveBeenCalled();

    // 실패한 실행도 이력으로 저장된다
    const stored = await service.getById("proj-1", run.id);
    expect(stored.status).toBe("FAILED");
  });

  it("없는 프로젝트는 404, 실행 레코드를 만들지 않는다", async () => {
    const prisma = createPrismaMock();
    const mocks = createServiceMocks();
    const service = await createService(prisma, mocks);

    await expect(service.run("nope")).rejects.toThrow(NotFoundException);
    expect(prisma.sopRun.create).not.toHaveBeenCalled();
  });

  it("이력 목록(최신순)/단건 조회, 없는 실행은 404", async () => {
    const prisma = createPrismaMock();
    const mocks = createServiceMocks();
    const service = await createService(prisma, mocks);

    const first = await service.run("proj-1");
    const second = await service.run("proj-1");

    const list = await service.list("proj-1");
    expect(list).toHaveLength(2);
    expect(list.map((run) => run.id)).toContain(first.id);
    expect(list.map((run) => run.id)).toContain(second.id);

    expect((await service.getById("proj-1", first.id)).id).toBe(first.id);
    await expect(service.getById("proj-1", "nope")).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getById("other", first.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

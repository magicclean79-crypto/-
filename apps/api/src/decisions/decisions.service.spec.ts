import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { DecisionsService } from "./decisions.service";
import { PrismaDecisionRepository } from "./prisma-decision.repository";
import {
  createPrismaMock,
  createRepositoryMock,
  validRequest,
} from "./decisions.spec-helpers";

describe("DecisionsService (Service Test)", () => {
  async function createService(
    repository = createRepositoryMock(),
    prisma = createPrismaMock(),
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DecisionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PrismaDecisionRepository, useValue: repository },
      ],
    }).compile();
    return moduleRef.get(DecisionsService);
  }

  it("결정을 생성한다 — 필드 트림, description 미지정 시 null", async () => {
    const service = await createService();

    const decision = await service.create("proj-1", {
      ...validRequest,
      title: `  ${validRequest.title}  `,
    });

    expect(decision.projectId).toBe("proj-1");
    expect(decision.title).toBe(validRequest.title);
    expect(decision.decisionType).toBe("architecture");
    expect(decision.author).toBe("CTO");

    const minimal = await service.create("proj-1", {
      ...validRequest,
      description: undefined,
    });
    expect(minimal.description).toBeNull();
  });

  it("필수 필드 누락·공백이면 400 (title/reason/decisionType/author)", async () => {
    const service = await createService();

    await expect(
      service.create("proj-1", { ...validRequest, title: "  " }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create("proj-1", {
        ...validRequest,
        reason: "",
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create("proj-1", {} as typeof validRequest),
    ).rejects.toThrow(BadRequestException);
  });

  it("없는 프로젝트는 404 (생성/목록)", async () => {
    const service = await createService();

    await expect(service.create("nope", validRequest)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.list("nope")).rejects.toThrow(NotFoundException);
  });

  it("목록(최신순)·단건 조회, 다른 프로젝트의 결정은 404", async () => {
    const service = await createService();
    const first = await service.create("proj-1", validRequest);
    const second = await service.create("proj-1", {
      ...validRequest,
      title: "두 번째 결정",
    });

    const list = await service.list("proj-1");
    expect(list.map((d) => d.id)).toEqual([second.id, first.id]);

    expect((await service.getById("proj-1", first.id)).id).toBe(first.id);
    await expect(service.getById("proj-1", "nope")).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getById("other", first.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("수정 — 지정한 필드만 변경, 공백 필수 필드는 400", async () => {
    const service = await createService();
    const created = await service.create("proj-1", validRequest);

    const updated = await service.update("proj-1", created.id, {
      reason: "추가 근거 확보",
      description: null,
    });
    expect(updated.reason).toBe("추가 근거 확보");
    expect(updated.description).toBeNull();
    expect(updated.title).toBe(created.title);

    await expect(
      service.update("proj-1", created.id, { title: " " }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.update("proj-1", "nope", { title: "x" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("삭제 — 삭제 후 조회는 404", async () => {
    const repository = createRepositoryMock();
    const service = await createService(repository);
    const created = await service.create("proj-1", validRequest);

    await service.delete("proj-1", created.id);
    expect(repository.delete).toHaveBeenCalledWith(created.id);
    await expect(service.getById("proj-1", created.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.delete("proj-1", created.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

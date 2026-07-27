import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { KnowledgeService } from "./knowledge.service";
import { PrismaKnowledgeRepository } from "./prisma-knowledge.repository";
import {
  createRepositoryMock,
  validRequest,
} from "./knowledge.spec-helpers";

describe("KnowledgeService (Service Test)", () => {
  async function createService(repository = createRepositoryMock()) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        { provide: PrismaKnowledgeRepository, useValue: repository },
      ],
    }).compile();
    return moduleRef.get(KnowledgeService);
  }

  it("지식을 생성한다 — 트림, category 미지정 시 null", async () => {
    const service = await createService();

    const knowledge = await service.create({
      ...validRequest,
      title: `  ${validRequest.title}  `,
    });
    expect(knowledge.title).toBe(validRequest.title);
    expect(knowledge.category).toBe("RULE");

    const minimal = await service.create({
      title: "분류 없는 지식",
      content: "내용",
    });
    expect(minimal.category).toBeNull();
  });

  it("필수 필드(title/content) 누락·공백이면 400", async () => {
    const service = await createService();

    await expect(
      service.create({ ...validRequest, title: " " }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ ...validRequest, content: "" }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({} as typeof validRequest),
    ).rejects.toThrow(BadRequestException);
  });

  it("category가 Enum 값이 아니면 400 (생성/수정)", async () => {
    const service = await createService();

    await expect(
      service.create({ ...validRequest, category: "금지어" as never }),
    ).rejects.toThrow(BadRequestException);

    const created = await service.create(validRequest);
    await expect(
      service.update(created.id, { category: "rule" as never }),
    ).rejects.toThrow(BadRequestException);

    const updated = await service.update(created.id, { category: "POLICY" });
    expect(updated.category).toBe("POLICY");
  });

  it("목록(최신순)·단건 조회, 없는 지식은 404", async () => {
    const service = await createService();
    const first = await service.create(validRequest);
    const second = await service.create({
      ...validRequest,
      title: "필수 고지",
      category: "LEGAL",
    });

    const list = await service.list();
    expect(list.map((item) => item.id)).toEqual([second.id, first.id]);

    expect((await service.getById(first.id)).id).toBe(first.id);
    await expect(service.getById("nope")).rejects.toThrow(NotFoundException);
  });

  it("수정 — 지정 필드만 변경, 공백 필수 필드는 400 · 삭제 후 404", async () => {
    const service = await createService();
    const created = await service.create(validRequest);

    const updated = await service.update(created.id, { category: null });
    expect(updated.category).toBeNull();
    expect(updated.title).toBe(created.title);

    await expect(
      service.update(created.id, { content: " " }),
    ).rejects.toThrow(BadRequestException);
    await expect(service.update("nope", { title: "x" })).rejects.toThrow(
      NotFoundException,
    );

    await service.delete(created.id);
    await expect(service.getById(created.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

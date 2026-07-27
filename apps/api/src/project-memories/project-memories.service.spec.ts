import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectMemoriesService } from "./project-memories.service";
import { PrismaProjectMemoryStore } from "./prisma-project-memory.store";
import {
  createPrismaMock,
  createStoreMock,
  validRequest,
} from "./project-memories.spec-helpers";

describe("ProjectMemoriesService (Service Test)", () => {
  async function createService(
    store = createStoreMock(),
    prisma = createPrismaMock(),
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectMemoriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: PrismaProjectMemoryStore, useValue: store },
      ],
    }).compile();
    return moduleRef.get(ProjectMemoriesService);
  }

  it("기억을 기록한다 — 트림, source 미지정 시 null", async () => {
    const service = await createService();

    const memory = await service.create("proj-1", {
      ...validRequest,
      title: `  ${validRequest.title}  `,
    });
    expect(memory.projectId).toBe("proj-1");
    expect(memory.title).toBe(validRequest.title);
    expect(memory.source).toBe("TASK-0303");

    const minimal = await service.create("proj-1", {
      title: "출처 없는 기억",
      content: "내용",
    });
    expect(minimal.source).toBeNull();
  });

  it("필수 필드(title/content) 누락·공백이면 400", async () => {
    const service = await createService();

    await expect(
      service.create("proj-1", { ...validRequest, title: " " }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create("proj-1", { ...validRequest, content: "" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("없는 프로젝트는 404 (기록/회상)", async () => {
    const service = await createService();

    await expect(service.create("nope", validRequest)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.list("nope")).rejects.toThrow(NotFoundException);
  });

  it("회상(최신순)·단건 조회, 다른 프로젝트의 기억은 404", async () => {
    const service = await createService();
    const first = await service.create("proj-1", validRequest);
    const second = await service.create("proj-1", {
      ...validRequest,
      title: "두 번째 기억",
    });

    const list = await service.list("proj-1");
    expect(list.map((memory) => memory.id)).toEqual([second.id, first.id]);

    expect((await service.getById("proj-1", first.id)).id).toBe(first.id);
    await expect(service.getById("proj-1", "nope")).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getById("other", first.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("수정 — 지정 필드만 변경, 공백 필수 필드는 400 · 삭제 후 404", async () => {
    const service = await createService();
    const created = await service.create("proj-1", validRequest);

    const updated = await service.update("proj-1", created.id, {
      source: null,
    });
    expect(updated.source).toBeNull();
    expect(updated.title).toBe(created.title);

    await expect(
      service.update("proj-1", created.id, { content: " " }),
    ).rejects.toThrow(BadRequestException);

    await service.delete("proj-1", created.id);
    await expect(service.getById("proj-1", created.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

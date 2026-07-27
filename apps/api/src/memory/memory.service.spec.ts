import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { MemoryService } from "./memory.service";
import { PrismaMemoryStore } from "./prisma-memory.store";
import {
  createPrismaMock,
  createStoreMock,
  validRequest,
} from "./memory.spec-helpers";

describe("MemoryService — Structured Memory (Service Test)", () => {
  async function createService(
    store = createStoreMock(),
    prisma = createPrismaMock(),
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PrismaMemoryStore, useValue: store },
      ],
    }).compile();
    return moduleRef.get(MemoryService);
  }

  it("구조화 값을 저장한다 — scopeId/description 미지정 시 null", async () => {
    const service = await createService();

    const memory = await service.create(validRequest);
    expect(memory.scope).toBe("PROJECT");
    expect(memory.scopeId).toBe("proj-1");
    expect(memory.value).toEqual({ tone: "친근함", emoji: false });

    const globalMemory = await service.create({
      scope: "GLOBAL",
      key: "max-title-length",
      value: 40,
    });
    expect(globalMemory.scopeId).toBeNull();
    expect(globalMemory.description).toBeNull();
  });

  it("검증 실패는 400 — Enum 외 scope, value 누락, 수정 필드 없음", async () => {
    const service = await createService();

    await expect(
      service.create({ ...validRequest, scope: "TEAM" as never }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ scope: "GLOBAL", key: "k" } as never),
    ).rejects.toThrow(BadRequestException);

    const created = await service.create(validRequest);
    await expect(service.update(created.id, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it("scope 규칙 — GLOBAL/COMPANY는 scopeId 금지, PROJECT/PRODUCT는 실존 검증", async () => {
    const service = await createService();

    await expect(
      service.create({ scope: "GLOBAL", scopeId: "x", key: "k", value: 1 }),
    ).rejects.toThrow(BadRequestException);

    // PROJECT: 없는 프로젝트 400, 있는 프로젝트 저장
    await expect(
      service.create({ scope: "PROJECT", scopeId: "nope", key: "k", value: 1 }),
    ).rejects.toThrow(BadRequestException);

    // PRODUCT: 없는 상품 400, 있는 상품 저장
    await expect(
      service.create({ scope: "PRODUCT", scopeId: "nope", key: "k", value: 1 }),
    ).rejects.toThrow(BadRequestException);
    const productMemory = await service.create({
      scope: "PRODUCT",
      scopeId: "prod-1",
      key: "size-chart",
      value: { unit: "cm" },
    });
    expect(productMemory.scope).toBe("PRODUCT");

    // COMPANY: scopeId 없이 저장
    const companyMemory = await service.create({
      scope: "COMPANY",
      key: "company-name",
      value: "매직클린",
    });
    expect(companyMemory.scopeId).toBeNull();
  });

  it("같은 (scope, scopeId, key)로 중복 생성하면 400", async () => {
    const service = await createService();
    await service.create(validRequest);

    await expect(service.create(validRequest)).rejects.toThrow(
      BadRequestException,
    );
    // 다른 범위/키는 허용
    await expect(
      service.create({ ...validRequest, scopeId: "proj-2" }),
    ).resolves.toBeDefined();
    await expect(
      service.create({ ...validRequest, key: "other-key" }),
    ).resolves.toBeDefined();
  });

  it("scope/scopeId 필터 목록·단건 조회, 없는 Memory는 404", async () => {
    const service = await createService();
    const project = await service.create(validRequest);
    await service.create({ scope: "GLOBAL", key: "k1", value: 1 });

    const all = await service.list();
    expect(all).toHaveLength(2);

    const projectOnly = await service.list("PROJECT", "proj-1");
    expect(projectOnly.map((memory) => memory.id)).toEqual([project.id]);
    expect(await service.list("GLOBAL")).toHaveLength(1);
    expect(await service.list("PROJECT", "nope")).toHaveLength(0);

    expect((await service.getById(project.id)).id).toBe(project.id);
    await expect(service.getById("nope")).rejects.toThrow(NotFoundException);
  });

  it("수정은 value/description만 — 식별자(scope/key)는 불변 · 삭제 후 404", async () => {
    const service = await createService();
    const created = await service.create(validRequest);

    const updated = await service.update(created.id, {
      value: { tone: "격식", emoji: true },
      description: null,
    });
    expect(updated.value).toEqual({ tone: "격식", emoji: true });
    expect(updated.description).toBeNull();
    expect(updated.key).toBe(created.key);

    // value로 JSON null도 저장할 수 있다
    const nulled = await service.update(created.id, { value: null });
    expect(nulled.value).toBeNull();

    await service.delete(created.id);
    await expect(service.getById(created.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

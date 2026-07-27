import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { CompanyBrainService } from "./company-brain.service";
import { createPrismaMock } from "./company-brain.spec-helpers";

describe("CompanyBrainService (Service Test)", () => {
  async function createService(prisma = createPrismaMock()) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CompanyBrainService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return moduleRef.get(CompanyBrainService);
  }

  it("조회 순서가 항상 Memory → Knowledge → Decision → SOP다 (CTO 지시)", async () => {
    const service = await createService();

    const response = await service.query({ query: "금지어" });

    expect(response.query).toBe("금지어");
    expect(response.results.map((section) => section.source)).toEqual([
      "MEMORY",
      "KNOWLEDGE",
      "DECISION",
      "SOP",
    ]);
    expect(response.results[0].items[0]).toMatchObject({
      key: "banned-words",
    });
    expect(response.results[1].items[0]).toMatchObject({ category: "RULE" });
    expect(response.results[2].items[0]).toMatchObject({
      decisionType: "POLICY",
    });
  });

  it("SOP 검색 — 정의의 이름/단계명 부분 일치 (실제 정의 대상)", async () => {
    const service = await createService();

    const byStep = await service.query({ query: "OCR" });
    const sops = byStep.results[3].items as { key: string }[];
    expect(sops.map((sop) => sop.key)).toEqual(["product-content"]);

    const noMatch = await service.query({ query: "존재하지않는절차명" });
    expect(noMatch.results[3].items).toEqual([]);
  });

  it("scope/scopeId 필터가 Memory where와 (PROJECT면) Decision where에 반영된다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    await service.query({
      query: "tone",
      scope: "PROJECT",
      scopeId: "proj-1",
    });

    expect(prisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scope: "PROJECT", scopeId: "proj-1" }),
      }),
    );
    expect(prisma.decision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: "proj-1" }),
      }),
    );

    // GLOBAL 필터는 Decision에 projectId를 강제하지 않는다
    await service.query({ query: "tone", scope: "GLOBAL" });
    const calls = prisma.decision.findMany.mock.calls as unknown as Array<
      [{ where: { projectId?: string } }]
    >;
    expect(calls[calls.length - 1][0].where.projectId).toBeUndefined();
  });

  it("검증 — 빈 query 400, Enum 외 scope 400, 잘못된 limit 400", async () => {
    const service = await createService();

    await expect(service.query({ query: "  " })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.query({ query: "q", scope: "TEAM" as never }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.query({ query: "q", limit: 0 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.query({ query: "q", limit: 101 }),
    ).rejects.toThrow(BadRequestException);
  });

  it("limit이 각 저장소 조회의 take로 전달된다 (기본 20)", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    await service.query({ query: "q" });
    expect(prisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );

    await service.query({ query: "q", limit: 5 });
    expect(prisma.knowledge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });
});

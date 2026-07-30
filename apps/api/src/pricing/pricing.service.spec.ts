import { Test } from "@nestjs/testing";
import { estimateOcrCost } from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";
import { PricingCacheBus } from "./pricing-cache.bus";
import { PRICING_CACHE_TTL_MS, PricingService } from "./pricing.service";

/**
 * 가격표 거버넌스 어댑터 검증. (TASK-3101 — CTO 정책 3101-①②)
 *
 * 절차 판정은 core(순수 함수)에서 검증하므로, 여기서는 **어댑터가 옳게
 * 연결되었는지**를 본다: 적용된 것만 실효 가격표에 반영되는가 / 시점별 단가가
 * 옳은가 / 조회가 실패해도 비용 계산을 포기하지 않는가.
 */

interface ProposalRow {
  id: string;
  target: string;
  key: string;
  price: Record<string, number>;
  stage: string;
  appliedAt: Date | null;
  /** 발효 시각 (TASK-3201) — 미래면 아직 계산에 쓰이지 않는다 */
  effectiveFrom?: Date | null;
}

function createPrisma(rows: ProposalRow[] = []) {
  const findMany = jest.fn(
    async (args?: { where?: { stage?: string; appliedAt?: unknown } }) => {
      let result = [...rows];
      if (args?.where?.stage !== undefined) {
        result = result.filter((row) => row.stage === args.where!.stage);
      }
      if (args?.where?.appliedAt !== undefined) {
        result = result.filter((row) => row.appliedAt !== null);
      }
      return result.map((row) => ({ ...row }));
    },
  );
  /** 단계 전이도 흉내 낸다 — 적용 경로(캐시 무효화)를 보려면 필요하다 */
  const findUnique = jest.fn(async (args: { where: { id: string } }) => {
    const found = rows.find((row) => row.id === args.where.id);
    return found ? { ...found, proposedBy: "someone@acos.local" } : null;
  });
  const update = jest.fn(
    async (args: {
      where: { id: string; stage?: string };
      data: Record<string, unknown>;
    }) => {
      const row = rows.find((candidate) => candidate.id === args.where.id);
      if (row === undefined) {
        throw new Error("없는 제안");
      }
      Object.assign(row, args.data);
      return {
        ...row,
        origin: "manual",
        evidence: null,
        currentPrice: null,
        reason: "테스트",
        proposedBy: "someone@acos.local",
        reviewedBy: null,
        reviewedAt: null,
        approvedBy: null,
        approvedAt: null,
        appliedBy: (args.data.appliedBy as string | null) ?? null,
        rejectedBy: null,
        rejectedAt: null,
        rejectedReason: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date(),
        effectiveFrom: (args.data.effectiveFrom as Date | null) ?? null,
      };
    },
  );
  return {
    findMany,
    stub: {
      pricingProposal: { findMany, findUnique, update },
    } as unknown as PrismaService,
  };
}

async function createService(rows: ProposalRow[] = []) {
  const prisma = createPrisma(rows);
  /** 무효화 버스 스텁 — 다른 인스턴스에 알렸는지 본다 (TASK-3201) */
  const published: string[] = [];
  const listeners: ((reason: string) => void)[] = [];
  const bus = {
    distributed: true,
    onInvalidate: (listener: (reason: string) => void) => {
      listeners.push(listener);
    },
    publish: async (reason: string) => {
      published.push(reason);
      return true;
    },
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      PricingService,
      { provide: PrismaService, useValue: prisma.stub },
      { provide: PricingCacheBus, useValue: bus },
    ],
  }).compile();
  // onModuleInit이 구독을 건다 — 실제 기동과 같은 상태로 만든다
  await moduleRef.init();
  return {
    service: moduleRef.get(PricingService),
    prisma,
    published,
    /** 다른 인스턴스가 보낸 신호를 흉내 낸다 */
    receive: (reason: string) => listeners.forEach((listener) => listener(reason)),
  };
}

const applied = (
  overrides: Partial<ProposalRow> = {},
): ProposalRow => ({
  id: "pp-1",
  target: "ocr",
  key: "google-vision",
  price: { perUnitUsd: 0.002 },
  stage: "APPLIED",
  appliedAt: new Date("2026-07-10T00:00:00.000Z"),
  effectiveFrom: new Date("2026-07-10T00:00:00.000Z"),
  ...overrides,
});

describe("PricingService (TASK-3101)", () => {
  it("적용된 제안만 실효 가격표에 반영한다", async () => {
    const { service } = await createService([
      applied(),
      // 승인만 된 것은 아직 계산에 쓰이지 않는다
      applied({
        id: "pp-2",
        key: "tesseract",
        price: { perUnitUsd: 9 },
        stage: "APPROVED",
        appliedAt: null,
      }),
    ]);

    const table = await service.effective();
    expect(table.ocr["google-vision"].perUnitUsd).toBe(0.002);
    expect(table.ocr["google-vision"].note).toContain("승인된 제안으로 적용됨");
    expect(table.ocr.tesseract.perUnitUsd).toBe(0);
  });

  it("실효 가격표가 실제 비용 계산에 쓰인다", async () => {
    const { service } = await createService([applied()]);
    const table = await service.effective();

    // 코드 기본값(0.0015)이 아니라 적용된 단가로 계산된다
    expect(estimateOcrCost("google-vision", 2, table.ocr)).toBe(0.004);
  });

  it("시점을 주면 그때까지 적용된 것만 본다 — 과거를 다시 계산하지 않는다", async () => {
    const { service } = await createService([applied()]);

    const before = await service.effectiveAt(new Date("2026-07-05T00:00:00Z"));
    expect(before.ocr["google-vision"].perUnitUsd).toBe(0.0015);

    const after = await service.effectiveAt(new Date("2026-07-15T00:00:00Z"));
    expect(after.ocr["google-vision"].perUnitUsd).toBe(0.002);
  });

  it("검증용 해석 함수는 이력을 한 번만 읽는다", async () => {
    // 표본마다 조회하면 1,000건 검증이 1,000번 질의가 된다
    const { service, prisma } = await createService([applied()]);
    prisma.findMany.mockClear();

    const resolvers = await service.resolvers();
    expect(prisma.findMany).toHaveBeenCalledTimes(1);

    expect(resolvers.ocr("2026-07-05T00:00:00.000Z")["google-vision"].perUnitUsd).toBe(
      0.0015,
    );
    expect(resolvers.ocr("2026-07-20T00:00:00.000Z")["google-vision"].perUnitUsd).toBe(
      0.002,
    );
    expect(prisma.findMany).toHaveBeenCalledTimes(1);
  });

  it("조회가 실패하면 기준 가격표로 계산한다 — 비용을 null로 남기지 않는다", async () => {
    // 비용이 null이면 그 호출은 예산 계산에서 빠지고 상한이 무력해진다
    const { service, prisma } = await createService();
    prisma.findMany.mockRejectedValue(new Error("DB 연결 실패"));

    const table = await service.effective();
    expect(table.ocr["google-vision"].perUnitUsd).toBe(0.0015);
    const resolvers = await service.resolvers();
    expect(resolvers.llm("2026-07-20T00:00:00.000Z")["gpt-4o"]).toBeDefined();
  });

  it("호출마다 조회하지 않는다 — 짧은 캐시를 둔다", async () => {
    const { service, prisma } = await createService([applied()]);
    await service.effective();
    const calls = prisma.findMany.mock.calls.length;
    await service.effective();
    expect(prisma.findMany.mock.calls.length).toBe(calls);
    // 영구 캐시는 두지 않는다 — 다른 인스턴스가 적용한 단가가 영원히
    // 반영되지 않으면 "적용하지 않은 것"과 결과가 같다
    expect(PRICING_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it("각 줄에 출처를 밝힌다 — 승인된 단가와 코드 기본값을 구분한다", async () => {
    // 구분되지 않으면 "이 금액은 누가 정했나"에 답할 수 없다 (라이브 검증에서
    // LLM 줄의 출처가 비어 있는 것을 보고 갈랐다)
    const { service } = await createService([
      applied({
        target: "llm",
        key: "gpt-4o",
        price: { inputPerMillion: 3, outputPerMillion: 12 },
      }),
    ]);
    const dto = await service.effectiveDto();

    const applied4o = dto.llm.find((row) => row.model === "gpt-4o");
    expect(applied4o?.note).toContain("승인된 제안으로 적용됨");
    const untouched = dto.llm.find((row) => row.model === "gpt-4o-mini");
    expect(untouched?.note).toContain("코드 기본값");
  });

  it("실효 가격표 응답은 이름순으로 정렬하고 적용 이력을 밝힌다", async () => {
    const { service } = await createService([applied()]);
    const dto = await service.effectiveDto();

    expect(dto.appliedCount).toBe(1);
    expect(dto.lastAppliedAt).toBe("2026-07-10T00:00:00.000Z");
    expect(dto.ocr.map((row) => row.provider)).toEqual([
      ...dto.ocr.map((row) => row.provider),
    ].sort());
  });
  describe("예약과 캐시 (TASK-3201, CTO 정책 3201-③⑤)", () => {
    it("미래 발효는 지금 계산에 쓰이지 않는다", async () => {
      const future = new Date(Date.now() + 86_400_000);
      const { service } = await createService([
        applied({ effectiveFrom: future }),
      ]);
      const table = await service.effective();
      expect(table.ocr["google-vision"].perUnitUsd).toBe(0.0015);
    });

    it("캐시는 다음 발효 시각을 넘기지 않는다", async () => {
      // 예약을 지나쳐 캐시하면 발효 순간이 조용히 늦어지고, 그 사이에 기록된
      // 비용은 아무도 설명할 수 없다
      const soon = new Date(Date.now() + 1_000);
      const { service, prisma } = await createService([
        applied({ effectiveFrom: soon }),
      ]);
      await service.effective();
      const calls = prisma.findMany.mock.calls.length;

      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const table = await service.effective();
      // 다시 읽었고, 이제는 새 단가가 쓰인다
      expect(prisma.findMany.mock.calls.length).toBeGreaterThan(calls);
      expect(table.ocr["google-vision"].perUnitUsd).toBe(0.002);
    });

    it("적용 즉시 다른 인스턴스에도 알린다", async () => {
      const { service, published } = await createService([
        applied({ id: "pp-x", stage: "APPROVED", appliedAt: null, effectiveFrom: null }),
      ]);

      await service.advance("pp-x", "APPLIED", "admin@acos.local");
      expect(published).toHaveLength(1);
      expect(published[0]).toContain("applied ocr/google-vision");
    });

    it("다른 인스턴스의 신호를 받으면 캐시를 버린다", async () => {
      const { service, prisma, receive } = await createService([applied()]);
      await service.effective();
      const calls = prisma.findMany.mock.calls.length;

      receive("applied ocr/google-vision by someone-else");
      await service.effective();
      // 캐시를 버렸으므로 다시 읽는다 — 버리지 않으면 옛 단가로 계산한다
      expect(prisma.findMany.mock.calls.length).toBeGreaterThan(calls);
    });
  });
});

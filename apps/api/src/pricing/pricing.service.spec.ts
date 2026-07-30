import { Test } from "@nestjs/testing";
import { estimateOcrCost } from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";
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
  return {
    findMany,
    stub: { pricingProposal: { findMany } } as unknown as PrismaService,
  };
}

async function createService(rows: ProposalRow[] = []) {
  const prisma = createPrisma(rows);
  const moduleRef = await Test.createTestingModule({
    providers: [
      PricingService,
      { provide: PrismaService, useValue: prisma.stub },
    ],
  }).compile();
  return { service: moduleRef.get(PricingService), prisma };
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
});

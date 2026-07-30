import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { GovernanceRulesService } from "../content-governance/governance-rules.service";
import { PrismaService } from "../prisma/prisma.service";
import { ReadyValidationService } from "./ready-validation.service";
import {
  createCompanyBrainMock,
  createPrismaMock,
  draftProductObject,
} from "./ready-validation.spec-helpers";

describe("ReadyValidationService (Service Test)", () => {
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    companyBrain: ReturnType<typeof createCompanyBrainMock>,
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReadyValidationService,
        // 거버넌스 규칙은 발행 게이트와 같은 곳에서 읽는다 (TASK-2501)
        GovernanceRulesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyBrainService, useValue: companyBrain },
      ],
    }).compile();
    return moduleRef.get(ReadyValidationService);
  }

  it("모든 검사 통과 시 PASS — 6개 검사와 버전 정보 반환", async () => {
    const service = await createService(
      createPrismaMock([draftProductObject]),
      createCompanyBrainMock({ bannedWords: ["최고", "1위"] }),
    );

    const result = await service.validate("proj-1", {});

    expect(result.status).toBe("PASS");
    expect(result.productObjectVersion).toBe(3);
    expect(result.checks).toHaveLength(6);
    expect(result.validatedAt).toBeTruthy();
  });

  it("금지어 발견 시 FAIL — Memory(GLOBAL, banned-words) 기반", async () => {
    const service = await createService(
      createPrismaMock([
        { ...draftProductObject, title: "국내 1위 매직클린 매트" },
      ]),
      createCompanyBrainMock({ bannedWords: ["최고", "1위"] }),
    );

    const result = await service.validate("proj-1", {});

    expect(result.status).toBe("FAIL");
    const check = result.checks.find((item) => item.key === "banned-words");
    expect(check?.status).toBe("FAIL");
    expect(check?.messages[0]).toContain("1위");
  });

  it("금지어 미설정·비배열 value는 WARNING(건너뜀)으로 판정", async () => {
    const unset = await createService(
      createPrismaMock([draftProductObject]),
      createCompanyBrainMock({}),
    );
    expect((await unset.validate("proj-1", {})).status).toBe("WARNING");

    const invalidValue = await createService(
      createPrismaMock([draftProductObject]),
      createCompanyBrainMock({ bannedWords: { not: "array" } }),
    );
    const result = await invalidValue.validate("proj-1", {});
    expect(
      result.checks.find((item) => item.key === "banned-words")?.status,
    ).toBe("WARNING");
  });

  it("RULE/LEGAL 지식은 WARNING, 결정은 정보성 PASS — CompanyBrain 조회 결과 반영", async () => {
    const companyBrain = createCompanyBrainMock({
      bannedWords: ["최고"],
      ruleKnowledge: [
        { title: "상세페이지 금지어", category: "RULE" },
        { title: "브랜드 가이드", category: "GUIDE" }, // RULE/LEGAL 아님 — 제외
      ],
      decisions: [{ title: "금지어 정책 도입" }],
    });
    const service = await createService(
      createPrismaMock([draftProductObject]),
      companyBrain,
    );

    const result = await service.validate("proj-1", {});

    expect(result.status).toBe("WARNING");
    const rules = result.checks.find((item) => item.key === "knowledge-rules");
    expect(rules?.status).toBe("WARNING");
    expect(rules?.messages[0]).toContain("상세페이지 금지어");
    expect(rules?.messages[0]).not.toContain("브랜드 가이드");
    expect(
      result.checks.find((item) => item.key === "decisions")?.status,
    ).toBe("PASS");

    // 제목 검색이 PROJECT 스코프로 수행되는지
    expect(companyBrain.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: draftProductObject.title,
        scope: "PROJECT",
        scopeId: "proj-1",
      }),
    );
  });

  it("전이 불가(ARCHIVED)는 FAIL", async () => {
    const service = await createService(
      createPrismaMock([{ ...draftProductObject, status: "ARCHIVED" }]),
      createCompanyBrainMock({ bannedWords: [] }),
    );

    const result = await service.validate("proj-1", {});
    expect(result.status).toBe("FAIL");
    expect(
      result.checks.find((item) => item.key === "transition")?.status,
    ).toBe("FAIL");
  });

  it("없는 프로젝트/버전 404, 잘못된 버전 400, 버전 지정 조회", async () => {
    const service = await createService(
      createPrismaMock([draftProductObject]),
      createCompanyBrainMock({ bannedWords: [] }),
    );

    await expect(service.validate("nope", {})).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.validate("proj-1", { productObjectVersion: 9 }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.validate("proj-1", { productObjectVersion: 0 }),
    ).rejects.toThrow(BadRequestException);

    const result = await service.validate("proj-1", {
      productObjectVersion: 3,
    });
    expect(result.productObjectVersion).toBe(3);
  });
});

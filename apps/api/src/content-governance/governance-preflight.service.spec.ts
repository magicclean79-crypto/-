import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  createPrismaMock,
  readyProductObject,
} from "../contents/contents.spec-helpers";
import { ContentGovernanceService } from "./content-governance.service";
import { GovernancePreflightService } from "./governance-preflight.service";
import { GovernanceRulesService } from "./governance-rules.service";
import { createCompanyBrainMock } from "./governance.spec-helpers";

const DISCLOSURE = {
  id: "wash",
  text: "사용 후 물로 충분히 헹구세요.",
  whenCategory: "생활용품",
  reason: "사내 규정",
};

interface Seed {
  title?: string;
  body: string;
  status?: string;
  projectId?: string;
  linked?: boolean;
}

async function build(
  seeds: Seed[],
  governance: Parameters<typeof createCompanyBrainMock>[0] = {},
) {
  const prisma = createPrismaMock();
  prisma.productObjects.push({ ...readyProductObject });
  for (const seed of seeds) {
    await prisma.content.create({
      data: {
        projectId: seed.projectId ?? "proj-1",
        productObjectId: seed.linked === false ? null : "po-1",
        title: seed.title ?? "매트",
        body: seed.body,
        status: seed.status ?? "REVIEW",
      } as never,
    });
  }

  const moduleRef = await Test.createTestingModule({
    providers: [
      GovernancePreflightService,
      ContentGovernanceService,
      GovernanceRulesService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: CompanyBrainService,
        useValue: createCompanyBrainMock(governance),
      },
    ],
  }).compile();

  return {
    prisma,
    service: moduleRef.get(GovernancePreflightService),
  };
}

/** 통과하는 본문 (고지 포함) */
const CLEAN = "깨끗한 매트입니다. 사용 후 물로 충분히 헹구세요.";
/** 금지어가 든 본문 */
const BANNED = "업계 1위 매트입니다. 사용 후 물로 충분히 헹구세요.";
/** 고지가 빠진 본문 */
const NO_DISCLOSURE = "그냥 매트입니다.";

const RULES = { bannedWords: ["최고", "1위"], disclosures: [DISCLOSURE] };

describe("GovernancePreflightService (TASK-2601, CTO 결정 2501-①)", () => {
  it("위반이 없으면 목록이 비고 위반 없음이라고 말한다", async () => {
    const { service } = await build([{ body: CLEAN }], RULES);
    const result = await service.scan({ projectId: "proj-1" });

    expect(result.summary).toMatchObject({ scanned: 1, blocked: 0, clean: 1 });
    expect(result.items).toEqual([]);
    expect(result.detail).toContain("위반 없음");
  });

  it("금지어·고지 위반을 찾아 목록으로 돌려준다", async () => {
    const { service } = await build(
      [{ body: BANNED }, { body: NO_DISCLOSURE }, { body: CLEAN }],
      RULES,
    );
    const result = await service.scan({ projectId: "proj-1" });

    expect(result.summary.scanned).toBe(3);
    expect(result.summary.blocked).toBe(2);
    expect(result.summary.clean).toBe(1);
    expect(result.summary.byCheck).toEqual([
      { key: "banned-words", blocked: 1, warned: 0 },
      { key: "disclosures", blocked: 1, warned: 0 },
    ]);
    expect(result.items).toHaveLength(2);
    expect(result.detail).toContain("발행이 막힐 것 2건");
  });

  describe("상태를 바꾸지 않고 고치지도 않는다", () => {
    it("스캔 후에도 콘텐츠가 그대로다", async () => {
      const { service, prisma } = await build([{ body: BANNED }], RULES);
      const before = [...prisma.contents.values()].map((row) => ({
        status: row.status,
        body: row.body,
        title: row.title,
      }));

      await service.scan({ projectId: "proj-1" });

      expect(
        [...prisma.contents.values()].map((row) => ({
          status: row.status,
          body: row.body,
          title: row.title,
        })),
      ).toEqual(before);
    });

    it("판정 기록을 남기지 않는다 — 훑어본 것은 발행 시도가 아니다", async () => {
      const { service, prisma } = await build([{ body: BANNED }], RULES);
      await service.scan({ projectId: "proj-1" });
      expect(prisma.governanceChecks).toHaveLength(0);
    });

    it("쓰기 함수를 아예 부르지 않는다", async () => {
      // 자동 수정을 만들지 않기로 한 것이 코드에 흔적으로 남아야 한다
      const { service, prisma } = await build([{ body: BANNED }], RULES);
      await service.scan({ projectId: "proj-1" });

      expect(prisma.content.update).not.toHaveBeenCalled();
      expect(prisma.content.create).toHaveBeenCalledTimes(1); // 준비 단계뿐
      expect(prisma.contentGovernanceCheck.create).not.toHaveBeenCalled();
      expect(prisma.contentStatusHistory.create).not.toHaveBeenCalled();
    });
  });

  describe("이미 나간 위반은 따로 센다", () => {
    it("기본은 아직 나가지 않은 것만 본다", async () => {
      const { service } = await build(
        [
          { body: BANNED, status: "REVIEW" },
          { body: BANNED, status: "PUBLISHED" },
        ],
        RULES,
      );
      const result = await service.scan({ projectId: "proj-1" });

      // 발행이 막힐 것을 미리 보는 것이 기본 목적이다
      expect(result.summary.scanned).toBe(1);
      expect(result.summary.blocked).toBe(1);
      expect(result.summary.publishedViolations).toBe(0);
    });

    it("PUBLISHED를 넣으면 이미 나간 위반을 드러낸다", async () => {
      const { service } = await build(
        [
          { body: BANNED, status: "REVIEW" },
          { body: BANNED, status: "PUBLISHED" },
        ],
        RULES,
      );
      const result = await service.scan({
        projectId: "proj-1",
        statuses: ["REVIEW", "PUBLISHED"],
      });

      expect(result.summary.scanned).toBe(2);
      expect(result.summary.blocked).toBe(1);
      expect(result.summary.publishedViolations).toBe(1);
      // 막을 수 없는 것을 먼저 말한다
      expect(result.detail).toContain("이미 발행된 위반 1건");
      expect(result.detail).toContain("내려야 합니다");
    });

    it("알 수 없는 상태는 400 — 조용히 무시하지 않는다", async () => {
      const { service } = await build([{ body: CLEAN }], RULES);
      await expect(
        service.scan({ projectId: "proj-1", statuses: ["REVIEWED"] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("발행 게이트와 같은 판정을 쓴다", () => {
    it("스캔이 막힌다고 한 것이 실제로 막힌다", async () => {
      const { service, prisma } = await build([{ body: BANNED }], RULES);
      const scan = await service.scan({ projectId: "proj-1" });
      const [contentId] = [...prisma.contents.keys()];

      const moduleRef = await Test.createTestingModule({
        providers: [
          ContentGovernanceService,
          GovernanceRulesService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: CompanyBrainService,
            useValue: createCompanyBrainMock(RULES),
          },
        ],
      }).compile();
      const gate = moduleRef.get(ContentGovernanceService);
      const verdict = await gate.evaluate("proj-1", contentId);

      // 스캔이 "막힐 것"이라고 한 것이 눌렀을 때 통과하면 스캔을 볼 이유가 없다
      expect(scan.items[0].contentId).toBe(contentId);
      expect(scan.items[0].blockedBy).toEqual(
        verdict.blockers.map((check) => check.key),
      );
      expect(verdict.publishable).toBe(false);
    });

    it("규칙 미설정은 주의로만 세고 막히는 것으로 세지 않는다", async () => {
      const { service } = await build([{ body: NO_DISCLOSURE }], {});
      const result = await service.scan({ projectId: "proj-1" });

      expect(result.summary.blocked).toBe(0);
      expect(result.summary.warned).toBe(1);
      expect(result.summary.byCheck.map((entry) => entry.key)).toEqual(
        expect.arrayContaining(["banned-words", "disclosures"]),
      );
    });
  });

  describe("범위", () => {
    it("프로젝트 범위는 그 프로젝트만 본다", async () => {
      const { service } = await build(
        [
          { body: BANNED, projectId: "proj-1" },
          { body: BANNED, projectId: "proj-2" },
        ],
        RULES,
      );
      const result = await service.scan({ projectId: "proj-1" });
      expect(result.summary.scanned).toBe(1);
      expect(result.projectId).toBe("proj-1");
    });

    it("전체 범위는 프로젝트를 가리지 않는다", async () => {
      const { service } = await build(
        [
          { body: BANNED, projectId: "proj-1" },
          { body: BANNED, projectId: "proj-2" },
        ],
        RULES,
      );
      const result = await service.scan({});
      expect(result.summary.scanned).toBe(2);
      expect(result.projectId).toBeNull();
    });

    it("없는 프로젝트는 404", async () => {
      const { service } = await build([{ body: CLEAN }], RULES);
      await expect(service.scan({ projectId: "nope" })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("목록을 자르되 조용히 자르지 않는다", () => {
    it("요약의 숫자는 자르기 전 전체다", async () => {
      const { service } = await build(
        Array.from({ length: 4 }, () => ({ body: BANNED })),
        RULES,
      );
      const result = await service.scan({ projectId: "proj-1", limit: 2 });

      expect(result.summary.blocked).toBe(4);
      expect(result.items).toHaveLength(2);
      expect(result.truncated).toBe(true);
      expect(result.omitted).toBe(2);
      expect(result.detail).toContain("발행이 막힐 것 4건");
      expect(result.detail).toContain("2건 생략");
    });

    it("잘못된 limit은 400 — 조용히 기본값으로 되돌리지 않는다", async () => {
      const { service } = await build([{ body: CLEAN }], RULES);
      for (const limit of [0, -1, 1.5, Number.NaN]) {
        await expect(
          service.scan({ projectId: "proj-1", limit }),
        ).rejects.toThrow(BadRequestException);
      }
    });
  });
});

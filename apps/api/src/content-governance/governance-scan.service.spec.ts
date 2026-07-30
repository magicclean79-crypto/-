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
import {
  ALL_SCOPE,
  GovernanceScanService,
  projectScope,
} from "./governance-scan.service";
import { createCompanyBrainMock } from "./governance.spec-helpers";

const DISCLOSURE = {
  id: "wash",
  text: "사용 후 물로 충분히 헹구세요.",
  whenCategory: "생활용품",
};
const RULES = { bannedWords: ["최고", "1위"], disclosures: [DISCLOSURE] };

/** 통과 / 금지어 / 고지 누락 본문 */
const CLEAN = "깨끗한 매트입니다. 사용 후 물로 충분히 헹구세요.";
const BANNED = "업계 1위 매트입니다. 사용 후 물로 충분히 헹구세요.";

async function build(
  seeds: { body: string; status?: string; projectId?: string }[] = [],
) {
  const prisma = createPrismaMock();
  prisma.productObjects.push({ ...readyProductObject });
  for (const seed of seeds) {
    await prisma.content.create({
      data: {
        projectId: seed.projectId ?? "proj-1",
        productObjectId: "po-1",
        title: "매트",
        body: seed.body,
        status: seed.status ?? "REVIEW",
      } as never,
    });
  }

  const moduleRef = await Test.createTestingModule({
    providers: [
      GovernanceScanService,
      GovernancePreflightService,
      ContentGovernanceService,
      GovernanceRulesService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: CompanyBrainService,
        useValue: createCompanyBrainMock(RULES),
      },
    ],
  }).compile();

  return { prisma, service: moduleRef.get(GovernanceScanService) };
}

/** 본문을 갈아 끼운다 (스캔 결과를 바꾸기 위해) */
function rewrite(
  prisma: ReturnType<typeof createPrismaMock>,
  index: number,
  body: string,
) {
  const row = [...prisma.contents.values()][index];
  row.body = body;
}

describe("GovernanceScanService (TASK-2701, CTO 결정 2601-②③)", () => {
  describe("첫 스캔은 기준선이다", () => {
    it("위반이 있어도 경보하지 않고, 그 사실을 기록한다", async () => {
      const { service } = await build([{ body: BANNED }, { body: BANNED }]);

      const { outcome, detected, shouldSync } = await service.run({
        trigger: "manual",
      });

      expect(detected).toEqual([]);
      // 첫 스캔에는 저장소를 건드리지 않는다 — 경보도, 해소도 없다
      expect(shouldSync).toBe(false);
      expect(outcome.run.verdict).toBe("baseline");
      expect(outcome.run.previousTotal).toBeNull();
      expect(outcome.run.total).toBe(2);
      expect(outcome.run.alerted).toBe(false);
      expect(outcome.run.detail).toContain("첫 스캔이므로 기준선");
    });

    it("경보를 만들지 않은 실행도 남는다 — 돌지 않은 것과 다르다", async () => {
      const { service, prisma } = await build([{ body: BANNED }]);
      await service.run({ trigger: "schedule" });

      expect(prisma.governanceScanRuns).toHaveLength(1);
      expect(prisma.governanceScanRuns[0]).toMatchObject({
        scope: ALL_SCOPE,
        alerted: false,
        trigger: "schedule",
      });
    });
  });

  describe("늘었을 때만 부른다", () => {
    it("늘면 경보한다", async () => {
      const { service, prisma } = await build([
        { body: BANNED },
        { body: CLEAN },
      ]);
      await service.run({ trigger: "schedule" }); // 기준선: 1건

      rewrite(prisma, 1, BANNED); // 2건으로 늘린다
      const { outcome, detected } = await service.run({ trigger: "schedule" });

      expect(detected).toHaveLength(1);
      expect(detected[0].title).toContain("늘었습니다");
      expect(detected[0].message).toContain("1건에서 2건으로 1건 늘었습니다");
      expect(outcome.run.verdict).toBe("increased");
      expect(outcome.run.alerted).toBe(true);
    });

    it("같은 결과로 반복 경보하지 않는다", async () => {
      const { service } = await build([{ body: BANNED }]);
      await service.run({ trigger: "schedule" }); // 기준선
      await service.run({ trigger: "schedule" }); // 늘지 않음

      const { outcome, detected, shouldSync } = await service.run({
        trigger: "schedule",
      });
      expect(outcome.run.verdict).toBe("unchanged");
      // 증가가 없으면 경보를 만들지도, 저장소를 건드리지도 않는다
      expect(detected).toEqual([]);
      expect(shouldSync).toBe(false);
      expect(outcome.run.alerted).toBe(false);
      expect(outcome.run.detail).toContain("반복 경보하지 않습니다");
    });

    it("줄어든 것으로는 경보하지 않는다", async () => {
      const { service, prisma } = await build([
        { body: BANNED },
        { body: BANNED },
      ]);
      await service.run({ trigger: "schedule" }); // 기준선: 2건

      rewrite(prisma, 0, CLEAN);
      const { outcome, detected, shouldSync } = await service.run({
        trigger: "schedule",
      });

      expect(outcome.run.verdict).toBe("decreased");
      expect(detected).toEqual([]);
      // 남아 있는 위반이 "풀렸다"로 해소되지 않게 저장소를 건드리지 않는다
      expect(shouldSync).toBe(false);
      expect(outcome.run.detail).toContain("줄어든 것으로는 경보하지 않습니다");
    });

    it("0이 되면 경보를 내린다", async () => {
      const { service, prisma } = await build([{ body: BANNED }]);
      await service.run({ trigger: "schedule" });

      rewrite(prisma, 0, CLEAN);
      const { outcome, detected, shouldSync } = await service.run({
        trigger: "schedule",
      });

      expect(outcome.run.verdict).toBe("resolved");
      // 빈 배열 + 동기화 = 해소
      expect(detected).toEqual([]);
      expect(shouldSync).toBe(true);
      expect(outcome.run.total).toBe(0);
    });

    it("줄었다가 다시 늘면 '늘었다'를 놓치지 않는다", async () => {
      // 경보를 낸 실행만 기준으로 삼으면 이 경우를 놓친다
      const { service, prisma } = await build([
        { body: BANNED },
        { body: BANNED },
        { body: CLEAN },
      ]);
      await service.run({ trigger: "schedule" }); // 기준선 2

      rewrite(prisma, 0, CLEAN); // 1건으로 감소
      expect((await service.run({ trigger: "schedule" })).outcome.run.verdict).toBe(
        "decreased",
      );

      rewrite(prisma, 2, BANNED); // 다시 2건
      const { outcome } = await service.run({ trigger: "schedule" });
      expect(outcome.run.verdict).toBe("increased");
      expect(outcome.run.previousTotal).toBe(1);
    });
  });

  describe("이미 나간 위반", () => {
    it("예약 스캔은 이미 나간 것까지 총량으로 센다", async () => {
      const { service } = await build([
        { body: BANNED, status: "REVIEW" },
        { body: BANNED, status: "PUBLISHED" },
      ]);
      const { outcome } = await service.run({ trigger: "schedule" });

      expect(outcome.run.summary.blocked).toBe(1);
      expect(outcome.run.summary.publishedViolations).toBe(1);
      expect(outcome.run.total).toBe(2);
    });

    it("이미 나간 위반이 섞이면 심각으로 부른다", async () => {
      const { service, prisma } = await build([
        { body: CLEAN, status: "PUBLISHED" },
      ]);
      await service.run({ trigger: "schedule" }); // 기준선 0

      rewrite(prisma, 0, BANNED);
      const { detected } = await service.run({ trigger: "schedule" });
      expect(detected[0].level).toBe("critical");
      expect(detected[0].message).toContain("내려야 합니다");
    });
  });

  describe("범위", () => {
    it("프로젝트 범위는 자기 기준선과 비교한다", async () => {
      const { service, prisma } = await build([
        { body: BANNED, projectId: "proj-1" },
        { body: BANNED, projectId: "proj-2" },
      ]);

      const all = await service.run({ trigger: "schedule" });
      expect(all.outcome.run.scope).toBe(ALL_SCOPE);
      expect(all.outcome.run.total).toBe(2);

      // 프로젝트 범위는 아직 기준선이 없다 — 전체 스캔이 기준을 세워 주지 않는다
      const project = await service.run({
        projectId: "proj-1",
        trigger: "schedule",
      });
      expect(project.outcome.run.scope).toBe(projectScope("proj-1"));
      expect(project.outcome.run.verdict).toBe("baseline");
      expect(project.outcome.run.total).toBe(1);
      expect(prisma.governanceScanRuns).toHaveLength(2);
    });

    it("경보 키가 범위마다 다르다", async () => {
      const { service, prisma } = await build([{ body: CLEAN }]);
      await service.run({ trigger: "schedule" });
      await service.run({ projectId: "proj-1", trigger: "schedule" });

      rewrite(prisma, 0, BANNED);
      const all = await service.run({ trigger: "schedule" });
      const project = await service.run({
        projectId: "proj-1",
        trigger: "schedule",
      });
      expect(all.detected[0].key).not.toBe(project.detected[0].key);
      expect(project.detected[0].key).toContain("project:proj-1");
    });
  });

  describe("이력", () => {
    it("최신순으로 돌려주고 범위로 가른다", async () => {
      const { service } = await build([{ body: BANNED }]);
      await service.run({ trigger: "schedule" });
      await service.run({ projectId: "proj-1", trigger: "manual" });

      const all = await service.history({ scope: ALL_SCOPE });
      expect(all).toHaveLength(1);
      expect(all[0].scope).toBe(ALL_SCOPE);

      const everything = await service.history();
      expect(everything).toHaveLength(2);
      expect(everything[0].trigger).toBe("manual");
    });

    it("이력 문구도 판정 이유를 담는다", async () => {
      const { service } = await build([{ body: BANNED }]);
      await service.run({ trigger: "schedule" });
      await service.run({ trigger: "schedule" });

      const [latest] = await service.history({ scope: ALL_SCOPE });
      expect(latest.detail).toContain("지난번과 같습니다");
    });
  });

  it("스캔은 상태를 바꾸지 않는다 — 기록은 스캔 실행 기록뿐이다", async () => {
    const { service, prisma } = await build([{ body: BANNED }]);
    const before = [...prisma.contents.values()].map((row) => row.status);

    await service.run({ trigger: "schedule" });

    expect([...prisma.contents.values()].map((row) => row.status)).toEqual(
      before,
    );
    // 발행을 시도한 것이 아니므로 판정 기록은 남지 않는다
    expect(prisma.governanceChecks).toHaveLength(0);
    expect(prisma.content.update).not.toHaveBeenCalled();
  });
});

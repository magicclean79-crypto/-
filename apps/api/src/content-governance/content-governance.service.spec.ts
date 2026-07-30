import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  createPrismaMock,
  readyProductObject,
} from "../contents/contents.spec-helpers";
import { ContentGovernanceService } from "./content-governance.service";
import { GovernanceRulesService } from "./governance-rules.service";
import { createCompanyBrainMock } from "./governance.spec-helpers";

const DISCLOSURE = {
  id: "wash",
  text: "사용 후 물로 충분히 헹구세요.",
  whenCategory: "생활용품",
  reason: "사내 규정",
};

async function build(
  governance: Parameters<typeof createCompanyBrainMock>[0] = {},
  content: { title?: string; body?: string; linked?: boolean } = {},
) {
  const prisma = createPrismaMock();
  prisma.productObjects.push({ ...readyProductObject });
  const created = await prisma.content.create({
    data: {
      projectId: "proj-1",
      productObjectId: content.linked === false ? null : "po-1",
      title: content.title ?? "순한 주방세제",
      body: content.body ?? "사용 후 물로 충분히 헹구세요.",
      status: "REVIEW",
    } as never,
  });

  const moduleRef = await Test.createTestingModule({
    providers: [
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
    contentId: created.id,
    service: moduleRef.get(ContentGovernanceService),
  };
}

describe("ContentGovernanceService (TASK-2501)", () => {
  it("판정만 하고 기록하지 않는다 — 보는 것과 시도하는 것은 다르다", async () => {
    const { service, prisma, contentId } = await build({
      bannedWords: ["최고"],
      disclosures: [DISCLOSURE],
    });

    const verdict = await service.evaluate("proj-1", contentId);
    expect(verdict.status).toBe("PASS");
    expect(verdict.publishable).toBe(true);
    expect(verdict.contentId).toBe(contentId);
    expect(prisma.governanceChecks).toHaveLength(0);
  });

  it("연결된 상품의 분류를 실제로 읽어 고지를 적용한다", async () => {
    // readyProductObject.category = "생활용품" — 고지 규칙의 whenCategory와 같다
    const { service, contentId } = await build(
      { disclosures: [DISCLOSURE] },
      { body: "좋은 세제입니다." },
    );

    const verdict = await service.evaluate("proj-1", contentId);
    const check = verdict.checks.find((item) => item.key === "disclosures")!;
    expect(check.status).toBe("FAIL");
    expect(verdict.publishable).toBe(false);
    expect(verdict.appliedRules.disclosureIds).toEqual(["wash"]);
  });

  it("규칙이 미설정이면 주의로 남고 발행은 막지 않는다", async () => {
    const { service, contentId } = await build({});
    const verdict = await service.evaluate("proj-1", contentId);
    expect(verdict.status).toBe("WARNING");
    expect(verdict.publishable).toBe(true);
    expect(verdict.appliedRules.bannedWordCount).toBeNull();
    expect(verdict.appliedRules.disclosureIds).toBeNull();
  });

  it("형식이 틀린 규칙을 빈 목록으로 읽지 않는다 — 그러면 위반 없음이 된다", async () => {
    const { service, contentId } = await build(
      { bannedWords: { words: ["최고"] }, disclosures: [{ text: "id 없음" }] },
      { title: "최고의 세제" },
    );

    const verdict = await service.evaluate("proj-1", contentId);
    const banned = verdict.checks.find((c) => c.key === "banned-words")!;
    // 형식이 틀렸으므로 "검사하지 못했다" — 통과가 아니다
    expect(banned.status).toBe("WARNING");
    expect(verdict.appliedRules.bannedWordCount).toBeNull();
    expect(verdict.appliedRules.disclosureIds).toBeNull();
  });

  it("형식 오류에 '설정되지 않았다'고 말하지 않는다 (자체 발견 결함)", async () => {
    // 등록은 되어 있는데 "설정되지 않았습니다"라고 하면, 운영자는 등록하러
    // 갔다가 이미 있는 것을 발견한다 — 상태와 설명이 모순되는 그 상태다
    const { service, contentId } = await build({
      bannedWords: { words: ["최고"] },
      disclosures: [{ text: "id 없음" }],
    });

    const verdict = await service.evaluate("proj-1", contentId);
    for (const key of ["banned-words", "disclosures"]) {
      const check = verdict.checks.find((c) => c.key === key)!;
      expect(check.messages[0]).toContain("형식이 올바르지 않아");
      expect(check.messages[0]).toContain("등록은 되어 있습니다");
      expect(check.messages[0]).not.toContain("설정되지 않아");
    }
  });

  it("아예 없으면 등록하라고 말한다 — 두 안내가 섞이지 않는다", async () => {
    const { service, contentId } = await build({});
    const verdict = await service.evaluate("proj-1", contentId);
    for (const key of ["banned-words", "disclosures"]) {
      const check = verdict.checks.find((c) => c.key === key)!;
      expect(check.messages[0]).toContain("설정되지 않아");
      expect(check.messages[0]).not.toContain("등록은 되어 있습니다");
    }
  });

  it("연결이 끊긴 콘텐츠는 주의로 드러낸다", async () => {
    const { service, contentId } = await build({}, { linked: false });
    const check = (await service.evaluate("proj-1", contentId)).checks.find(
      (item) => item.key === "source-object",
    )!;
    expect(check.status).toBe("WARNING");
    expect(check.messages[0]).toContain("추적할 수 없습니다");
  });

  it("없는 콘텐츠는 404", async () => {
    const { service } = await build();
    await expect(service.evaluate("proj-1", "none")).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.history("proj-1", "none")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("다른 프로젝트의 콘텐츠는 보이지 않는다", async () => {
    const { service, contentId } = await build();
    await expect(service.evaluate("proj-2", contentId)).rejects.toThrow(
      NotFoundException,
    );
  });

  describe("판정 기록", () => {
    it("막힌 기록도 남는다 — 지연을 설명할 수 있어야 한다", async () => {
      const { service, prisma, contentId } = await build(
        { bannedWords: ["최고"] },
        { title: "최고의 세제" },
      );

      const verdict = await service.judge({
        id: contentId,
        projectId: "proj-1",
        status: "REVIEW",
        title: "최고의 세제",
        body: "본문",
        productObject: { version: 2, status: "READY", category: "생활용품" },
      });
      await service.record(contentId, verdict, {
        published: false,
        actor: "editor@acos.local",
      });

      const [record] = await service.history("proj-1", contentId);
      expect(record.status).toBe("FAIL");
      expect(record.published).toBe(false);
      expect(record.blockedBy).toEqual(["banned-words"]);
      expect(record.actor).toBe("editor@acos.local");
      expect(prisma.governanceChecks).toHaveLength(1);
    });

    it("판정 당시 기준을 함께 남긴다 — 규칙은 나중에 바뀐다", async () => {
      const { service, contentId } = await build({
        bannedWords: ["최고", "1위"],
        disclosures: [DISCLOSURE],
      });

      const verdict = await service.judge({
        id: contentId,
        projectId: "proj-1",
        status: "REVIEW",
        title: "순한 주방세제",
        body: "사용 후 물로 충분히 헹구세요.",
        productObject: { version: 2, status: "READY", category: "생활용품" },
      });
      await service.record(contentId, verdict, {
        published: true,
        actor: null,
      });

      const [record] = await service.history("proj-1", contentId);
      expect(record.appliedRules.bannedWordCount).toBe(2);
      expect(record.appliedRules.disclosureIds).toEqual(["wash"]);
      // 검사 결과 전체가 남는다 — 등급만 남으면 무엇을 봤는지 알 수 없다
      expect(record.checks.map((check) => check.key)).toEqual([
        "content-body",
        "banned-words",
        "disclosures",
        "source-object",
        "related-rules",
      ]);
    });

    it("이력은 최신순이다", async () => {
      const { service, contentId } = await build({});
      const base = {
        id: contentId,
        projectId: "proj-1",
        status: "REVIEW" as const,
        title: "제목",
        body: "본문",
        productObject: null,
      };
      for (const published of [false, true]) {
        await service.record(contentId, await service.judge(base), {
          published,
          actor: null,
        });
      }
      const records = await service.history("proj-1", contentId);
      expect(records).toHaveLength(2);
      expect(records[0].published).toBe(true);
    });
  });

  describe("판정 함수는 하나다 (CTO 결정 2301-① 계열)", () => {
    it("미리보기와 게이트가 같은 답을 낸다", async () => {
      const { service, contentId } = await build(
        { bannedWords: ["최고"], disclosures: [DISCLOSURE] },
        { title: "최고의 세제", body: "본문" },
      );

      // 화면이 "발행 가능"이라 했는데 누르면 막히는 상태를 구조적으로 없앤다
      const preview = await service.evaluate("proj-1", contentId);
      const gate = await service.judge({
        id: contentId,
        projectId: "proj-1",
        status: "REVIEW",
        title: "최고의 세제",
        body: "본문",
        productObject: { version: 2, status: "READY", category: "생활용품" },
      });

      expect(preview.publishable).toBe(gate.publishable);
      expect(preview.status).toBe(gate.status);
      expect(preview.blockers.map((b) => b.key)).toEqual(
        gate.blockers.map((b) => b.key),
      );
    });
  });
});

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDefaultPromptEngine, MockLlmProvider } from "@acos/core";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { ContentGovernanceService } from "../content-governance/content-governance.service";
import { GovernanceRulesService } from "../content-governance/governance-rules.service";
import { createCompanyBrainMock } from "../content-governance/governance.spec-helpers";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { ContentGenerationService } from "./content-generation.service";
import { CONTENT_GENERATOR } from "./contents.constants";
import { ContentsService } from "./contents.service";
import {
  createPrismaMock,
  readyProductObject,
} from "./contents.spec-helpers";
import { EngineContentGenerator } from "./engine-content.generator";

/** 공식 엔진을 mock LLM + 빈 Company Brain으로 구성 — 운영 기본 구성과 동일한 경로 */
function createEngine(
  prisma: ReturnType<typeof createPrismaMock>,
): ContentGenerationService {
  const companyBrain = {
    query: jest.fn(async () => ({ query: "", results: [] })),
  } as unknown as CompanyBrainService;
  return new ContentGenerationService(
    prisma as unknown as PrismaService,
    companyBrain,
    new LlmService(new MockLlmProvider()),
    createDefaultPromptEngine(),
  );
}

describe("ContentsService (Service Test)", () => {
  /**
   * 발행 게이트를 포함해 조립한다 (TASK-2501).
   *
   * `governance` 옵션으로 거버넌스 규칙(금지어·필수 고지)을 준다 — 주지
   * 않으면 규칙 미설정 상태이므로 `주의`가 되고 발행은 막히지 않는다.
   */
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    engine: ContentGenerationService = createEngine(prisma),
    governance: Parameters<typeof createCompanyBrainMock>[0] = {},
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContentsService,
        ContentGovernanceService,
        GovernanceRulesService,
        {
          provide: CompanyBrainService,
          useValue: createCompanyBrainMock(governance),
        },
        { provide: PrismaService, useValue: prisma },
        {
          // TASK-0506: 구 Generator 경로는 Wrapper를 통해 공식 엔진 호출
          provide: CONTENT_GENERATOR,
          useValue: new EngineContentGenerator(engine),
        },
      ],
    }).compile();
    return moduleRef.get(ContentsService);
  }

  it("최신 READY Product Object로 상세페이지를 생성한다 (내부는 공식 엔진)", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const service = await createService(prisma);

    const content = await service.generate("proj-1", {});

    expect(content.status).toBe("DRAFT");
    expect(content.productObjectVersion).toBe(2);
    // mock LLM 응답에는 Markdown 제목이 없어 fallback 제목이 쓰인다
    expect(content.title).toBe("Magic Clean PVC Mat 상세페이지");
    expect(content.body).toContain("[mock-llm]");
  });

  it("구 경로와 공식 경로(engine)는 같은 PO에 대해 같은 본문을 생성한다 (통합 검증)", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const engine = createEngine(prisma);
    const service = await createService(prisma, engine);

    const legacy = await service.generate("proj-1", {});
    const official = await engine.generate("proj-1", {});

    expect(legacy.body).toBe(official.body);
    expect(legacy.title).toBe(official.title);
  });

  it("READY Product Object가 없으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({
      ...readyProductObject,
      status: "DRAFT",
    });
    const service = await createService(prisma);

    await expect(service.generate("proj-1", {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it("버전 지정: READY가 아니면 400, 없으면 404", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push(
      { ...readyProductObject, version: 1, status: "DRAFT", id: "po-d" },
      { ...readyProductObject },
    );
    const service = await createService(prisma);

    const content = await service.generate("proj-1", {
      productObjectVersion: 2,
    });
    expect(content.productObjectVersion).toBe(2);

    await expect(
      service.generate("proj-1", { productObjectVersion: 1 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.generate("proj-1", { productObjectVersion: 9 }),
    ).rejects.toThrow(NotFoundException);
  });

  describe("발행 파이프라인 (TASK-0703)", () => {
    async function setup() {
      const prisma = createPrismaMock();
      prisma.productObjects.push({ ...readyProductObject });
      const service = await createService(prisma);
      const content = await service.generate("proj-1", {});
      return { prisma, service, content };
    }

    it("DRAFT → REVIEW → PUBLISHED(발행 시각 기록) → ARCHIVED", async () => {
      const { service, content } = await setup();

      const review = await service.updateStatus("proj-1", content.id, "REVIEW");
      expect(review.status).toBe("REVIEW");
      expect(review.publishedAt).toBeNull();

      const published = await service.updateStatus(
        "proj-1",
        content.id,
        "PUBLISHED",
      );
      expect(published.status).toBe("PUBLISHED");
      expect(published.publishedAt).not.toBeNull();

      const archived = await service.updateStatus(
        "proj-1",
        content.id,
        "ARCHIVED",
      );
      expect(archived.status).toBe("ARCHIVED");
      expect(archived.publishedAt).toBe(published.publishedAt); // 발행 이력 보존
    });

    it("REVIEW → DRAFT 되돌리기를 허용한다", async () => {
      const { service, content } = await setup();
      await service.updateStatus("proj-1", content.id, "REVIEW");
      const back = await service.updateStatus("proj-1", content.id, "DRAFT");
      expect(back.status).toBe("DRAFT");
    });

    it("DRAFT → PUBLISHED 건너뛰기는 400", async () => {
      const { service, content } = await setup();
      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow(BadRequestException);
    });

    it("보관된 콘텐츠는 DRAFT로만 되살릴 수 있다 (TASK-2701, CTO 결정 2601-①)", async () => {
      const { service, content } = await setup();
      await service.updateStatus("proj-1", content.id, "ARCHIVED");

      // 발행으로 직행하면 게이트를 우회한다 — 안내가 경로를 말한다
      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow(/DRAFT로 되살린 뒤 REVIEW를 거쳐/);
      await expect(
        service.updateStatus("proj-1", content.id, "REVIEW"),
      ).rejects.toThrow(BadRequestException);

      // 공식 절차: PUBLISHED → ARCHIVED → 수정 → 재발행
      expect(
        (await service.updateStatus("proj-1", content.id, "DRAFT")).status,
      ).toBe("DRAFT");
    });

    it("본문이 비어 있으면 발행(400) — isPublishable 검증", async () => {
      const { prisma, service, content } = await setup();
      await service.updateStatus("proj-1", content.id, "REVIEW");
      const row = prisma.contents.get(content.id);
      if (row) {
        row.body = "";
      }

      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow("발행 조건");
    });

    it("잘못된 status 값은 400, 없는 콘텐츠는 404", async () => {
      const { service, content } = await setup();
      await expect(
        service.updateStatus("proj-1", content.id, "LIVE"),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateStatus("proj-1", "nope", "REVIEW"),
      ).rejects.toThrow(NotFoundException);
    });

    it("전이마다 감사 이력(from→to)이 기록되고 최신순으로 조회된다 (TASK-0704)", async () => {
      const { service, content } = await setup();
      await service.updateStatus("proj-1", content.id, "REVIEW");
      await service.updateStatus("proj-1", content.id, "PUBLISHED");
      await service.updateStatus("proj-1", content.id, "ARCHIVED");

      const history = await service.getStatusHistory("proj-1", content.id);

      expect(
        history.map((item) => `${item.fromStatus}→${item.toStatus}`),
      ).toEqual(["PUBLISHED→ARCHIVED", "REVIEW→PUBLISHED", "DRAFT→REVIEW"]);
      expect(history[0].contentId).toBe(content.id);
      expect(history[0].createdAt).toBeTruthy();
    });

    it("재발행 시 publishedAt은 최초 발행 시점을 보존한다 (CTO 결정)", async () => {
      const { service, content } = await setup();
      await service.updateStatus("proj-1", content.id, "REVIEW");
      const first = await service.updateStatus("proj-1", content.id, "PUBLISHED");
      // PUBLISHED → ARCHIVED 후 이력만 남고 publishedAt은 변하지 않는다
      const archived = await service.updateStatus(
        "proj-1",
        content.id,
        "ARCHIVED",
      );
      expect(archived.publishedAt).toBe(first.publishedAt);
    });

    it("없는 콘텐츠의 이력 조회는 404", async () => {
      const { service } = await setup();
      await expect(
        service.getStatusHistory("proj-1", "nope"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("발행 거버넌스 게이트 (TASK-2501)", () => {
    /**
     * `readyProductObject`의 분류는 "생활용품"이다 — 분류별 고지 규칙이
     * 실제로 적용되는지 보려면 그 값을 그대로 써야 한다.
     */
    const DISCLOSURE = {
      id: "wash",
      text: "사용 후 물로 충분히 헹구세요.",
      whenCategory: "생활용품",
      reason: "사내 규정",
    };

    async function setup(
      governance: Parameters<typeof createCompanyBrainMock>[0] = {},
    ) {
      const prisma = createPrismaMock();
      prisma.productObjects.push({ ...readyProductObject });
      const service = await createService(prisma, undefined, governance);
      const content = await service.generate("proj-1", {});
      await service.updateStatus("proj-1", content.id, "REVIEW");
      return { prisma, service, content };
    }

    /** 본문을 갈아 끼운다 — 생성 본문에 특정 문구를 넣기 위해 */
    async function rewrite(
      prisma: ReturnType<typeof createPrismaMock>,
      contentId: string,
      body: string,
    ) {
      const row = prisma.contents.get(contentId)!;
      row.body = body;
    }

    it("금지어가 든 본문은 발행되지 않는다", async () => {
      // 그 전까지 발행 조건은 "REVIEW + 제목·본문 있음"뿐이었다 —
      // 금지어가 든 본문도 그냥 나갔다
      const { prisma, service, content } = await setup({
        bannedWords: ["최고", "1위"],
      });
      await rewrite(prisma, content.id, "이 제품은 업계 1위입니다.");

      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow(BadRequestException);

      // 상태는 그대로 REVIEW — 막혔으면 바뀌지 않아야 한다
      expect((await service.getById("proj-1", content.id)).status).toBe(
        "REVIEW",
      );
      expect((await service.getById("proj-1", content.id)).publishedAt).toBeNull();
    });

    it("차단 사유에 무엇이 걸렸는지 담긴다 — 고칠 수 있어야 한다", async () => {
      const { prisma, service, content } = await setup({
        bannedWords: ["1위"],
      });
      await rewrite(prisma, content.id, "업계 1위입니다.");

      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow(/1위/);
    });

    it("필수 고지가 빠지면 발행되지 않는다", async () => {
      const { prisma, service, content } = await setup({
        disclosures: [DISCLOSURE],
      });
      await rewrite(prisma, content.id, "좋은 매트입니다.");

      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow(/사용 후 물로 충분히 헹구세요/);
    });

    it("고지를 넣으면 발행된다", async () => {
      const { prisma, service, content } = await setup({
        bannedWords: ["최고"],
        disclosures: [DISCLOSURE],
      });
      await rewrite(
        prisma,
        content.id,
        "좋은 매트입니다. 사용 후 물로 충분히 헹구세요.",
      );

      const published = await service.updateStatus(
        "proj-1",
        content.id,
        "PUBLISHED",
      );
      expect(published.status).toBe("PUBLISHED");
      expect(published.publishedAt).not.toBeNull();
    });

    it("주의만 있으면 발행을 막지 않는다 — 미구성과 위반은 다르다", async () => {
      // 금지어·고지 규칙이 미설정이면 WARNING이지만 발행은 된다
      const { service, content } = await setup({});
      expect(
        (await service.updateStatus("proj-1", content.id, "PUBLISHED")).status,
      ).toBe("PUBLISHED");
    });

    it("발행이 아닌 전이는 거버넌스로 막지 않는다", async () => {
      // 검토를 요청하는 것과 세상에 내보내는 것은 다르다
      const prisma = createPrismaMock();
      prisma.productObjects.push({ ...readyProductObject });
      const service = await createService(prisma, undefined, {
        bannedWords: ["최고", "Magic"],
      });
      const content = await service.generate("proj-1", {});

      expect(
        (await service.updateStatus("proj-1", content.id, "REVIEW")).status,
      ).toBe("REVIEW");
      expect(
        (await service.updateStatus("proj-1", content.id, "ARCHIVED")).status,
      ).toBe("ARCHIVED");
      // 발행 시도가 없었으므로 판정 기록도 없다
      expect(prisma.governanceChecks).toHaveLength(0);
    });

    it("막힌 판정도 기록에 남는다", async () => {
      const { prisma, service, content } = await setup({
        bannedWords: ["1위"],
      });
      await rewrite(prisma, content.id, "업계 1위입니다.");

      await expect(
        service.updateStatus(
          "proj-1",
          content.id,
          "PUBLISHED",
          "editor@acos.local",
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.governanceChecks).toHaveLength(1);
      const [record] = prisma.governanceChecks;
      expect(record.status).toBe("FAIL");
      expect(record.published).toBe(false);
      expect(record.blockedBy).toEqual(["banned-words"]);
      expect(record.actor).toBe("editor@acos.local");
    });

    it("통과한 판정도 기록에 남는다 — 그때의 기준과 함께", async () => {
      const { prisma, service, content } = await setup({
        bannedWords: ["최고", "1위"],
        disclosures: [DISCLOSURE],
      });
      await rewrite(
        prisma,
        content.id,
        "좋은 매트입니다. 사용 후 물로 충분히 헹구세요.",
      );

      await service.updateStatus("proj-1", content.id, "PUBLISHED");
      const [record] = prisma.governanceChecks;
      expect(record.published).toBe(true);
      expect(record.blockedBy).toEqual([]);
      expect(record.appliedRules).toMatchObject({
        bannedWordCount: 2,
        disclosureIds: ["wash"],
      });
    });

    it("막힌 뒤 고쳐서 발행하면 두 기록이 남는다", async () => {
      // "왜 이렇게 늦게 발행됐지"에 답할 수 있어야 한다
      const { prisma, service, content } = await setup({
        bannedWords: ["1위"],
      });
      await rewrite(prisma, content.id, "업계 1위입니다.");
      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow(BadRequestException);

      await rewrite(prisma, content.id, "좋은 매트입니다.");
      await service.updateStatus("proj-1", content.id, "PUBLISHED");

      expect(prisma.governanceChecks.map((row) => row.published)).toEqual([
        false,
        true,
      ]);
    });

    it("발행 형식 검증은 거버넌스보다 먼저다 — 빈 본문은 판정 기록을 만들지 않는다", async () => {
      const { prisma, service, content } = await setup({});
      await rewrite(prisma, content.id, "");

      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow(/발행 조건을 충족하지 않습니다/);
      expect(prisma.governanceChecks).toHaveLength(0);
    });
  });

  it("없는 프로젝트는 404, 목록/단건 조회 동작", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const service = await createService(prisma);

    await expect(service.generate("nope", {})).rejects.toThrow(
      NotFoundException,
    );

    const created = await service.generate("proj-1", {});
    expect(await service.list("proj-1")).toHaveLength(1);
    expect((await service.getById("proj-1", created.id)).id).toBe(created.id);
    await expect(service.getById("proj-1", "nope")).rejects.toThrow(
      NotFoundException,
    );
  });
});

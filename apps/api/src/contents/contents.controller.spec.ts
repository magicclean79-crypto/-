import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { ContentGovernanceService } from "../content-governance/content-governance.service";
import { GovernanceRulesService } from "../content-governance/governance-rules.service";
import { createCompanyBrainMock } from "../content-governance/governance.spec-helpers";
import { PrismaService } from "../prisma/prisma.service";
import { ContentGenerationService } from "./content-generation.service";
import { CONTENT_GENERATOR } from "./contents.constants";
import { ContentsController } from "./contents.controller";
import { ContentsService } from "./contents.service";
import {
  createPrismaMock,
  readyProductObject,
} from "./contents.spec-helpers";
import { EngineContentGenerator } from "./engine-content.generator";
import { AuthGuard } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";

describe("Contents API (API Test)", () => {
  let app: INestApplication;
  const prismaMock = createPrismaMock();
  // TASK-0506: 구 경로가 공식 엔진(generateMarkdown)을 호출하는지 검증하는 목업
  const engineMock = {
    generate: jest.fn(),
    generateMarkdown: jest.fn(async () => ({
      title: "엔진 생성 상세페이지",
      body: "# 엔진 생성 상세페이지\n\n공식 엔진 본문",
      llm: { provider: "mock", model: "mock-llm-1" },
    })),
  };

  beforeAll(async () => {
    prismaMock.productObjects.push({ ...readyProductObject });

    const moduleRef = await Test.createTestingModule({
      controllers: [ContentsController],
      providers: [
        ContentsService,
        // 발행 게이트 (TASK-2501) — 금지어를 등록해 실제로 막히는지도 본다
        ContentGovernanceService,
        GovernanceRulesService,
        {
          provide: CompanyBrainService,
          useValue: createCompanyBrainMock({ bannedWords: ["최고", "1위"] }),
        },
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: CONTENT_GENERATOR,
          useValue: new EngineContentGenerator(
            engineMock as unknown as ContentGenerationService,
          ),
        },
        {
          provide: ContentGenerationService,
          useValue: engineMock,
        },
        AuthGuard,
        {
          // TASK-0801: 전이는 EDITOR 이상 — 테스트용 토큰 매핑
          provide: AuthService,
          useValue: {
            validateToken: async (token: string) =>
              token === "editor-token"
                ? {
                    id: "u-editor",
                    email: "editor@acos.local",
                    name: "에디터",
                    role: "EDITOR",
                    createdAt: "",
                  }
                : token === "viewer-token"
                  ? {
                      id: "u-viewer",
                      email: "viewer@acos.local",
                      name: "뷰어",
                      role: "VIEWER",
                      createdAt: "",
                    }
                  : null,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /projects/:id/contents — 구 계약 유지, 내부는 공식 엔진 호출 (TASK-0506)", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/contents")
      .send({})
      .expect(201);

    expect(response.body).toMatchObject({
      projectId: "proj-1",
      productObjectVersion: 2,
      status: "DRAFT",
      title: "엔진 생성 상세페이지",
    });
    expect(response.body.body).toContain("# 엔진 생성 상세페이지");
    expect(engineMock.generateMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ id: "proj-1" }),
        productObject: expect.objectContaining({
          title: "Magic Clean PVC Mat",
          version: 2,
          ocrText: "Magic Clean PVC Mat",
        }),
      }),
    );
  });

  it("GET /projects/:id/contents — 목록", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/contents")
      .expect(200);

    expect(response.body.contents.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /projects/:id/contents/:contentId — 단건/404", async () => {
    const list = await request(app.getHttpServer()).get(
      "/projects/proj-1/contents",
    );
    const id = list.body.contents[0].id;

    const response = await request(app.getHttpServer())
      .get(`/projects/proj-1/contents/${id}`)
      .expect(200);
    expect(response.body.id).toBe(id);

    await request(app.getHttpServer())
      .get("/projects/proj-1/contents/nope")
      .expect(404);
  });

  it("PATCH /projects/:id/contents/:contentId/status — 발행 파이프라인 (TASK-0703, 인증 필요)", async () => {
    const created = await request(app.getHttpServer())
      .post("/projects/proj-1/contents")
      .send({})
      .expect(201);
    const id = created.body.id;

    // TASK-0801: 무토큰 401, VIEWER 403 (EDITOR 이상 요구)
    await request(app.getHttpServer())
      .patch(`/projects/proj-1/contents/${id}/status`)
      .send({ status: "REVIEW" })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/projects/proj-1/contents/${id}/status`)
      .set("Authorization", "Bearer viewer-token")
      .send({ status: "REVIEW" })
      .expect(403);

    const review = await request(app.getHttpServer())
      .patch(`/projects/proj-1/contents/${id}/status`)
      .set("Authorization", "Bearer editor-token")
      .send({ status: "REVIEW" })
      .expect(200);
    expect(review.body.status).toBe("REVIEW");

    const published = await request(app.getHttpServer())
      .patch(`/projects/proj-1/contents/${id}/status`)
      .set("Authorization", "Bearer editor-token")
      .send({ status: "PUBLISHED" })
      .expect(200);
    expect(published.body.status).toBe("PUBLISHED");
    expect(published.body.publishedAt).toBeTruthy();

    // PUBLISHED → REVIEW 역행은 400
    await request(app.getHttpServer())
      .patch(`/projects/proj-1/contents/${id}/status`)
      .set("Authorization", "Bearer editor-token")
      .send({ status: "REVIEW" })
      .expect(400);

    // 감사 이력 조회 (TASK-0704) — 최신순 + actor 기록 (TASK-0801)
    const history = await request(app.getHttpServer())
      .get(`/projects/proj-1/contents/${id}/history`)
      .expect(200);
    expect(
      history.body.history.map(
        (item: { fromStatus: string; toStatus: string; actor: string | null }) =>
          `${item.fromStatus}→${item.toStatus}@${item.actor}`,
      ),
    ).toEqual([
      "REVIEW→PUBLISHED@editor@acos.local",
      "DRAFT→REVIEW@editor@acos.local",
    ]);
  });

  it("POST — 없는 프로젝트 404", async () => {
    await request(app.getHttpServer())
      .post("/projects/nope/contents")
      .send({})
      .expect(404);
  });

  it("POST /projects/:id/contents/generate — Content Generation Engine으로 라우팅 (TASK-0502)", async () => {
    const engine = app.get(ContentGenerationService) as unknown as {
      generate: jest.Mock;
    };
    engine.generate.mockResolvedValue({
      id: "content-gen-1",
      projectId: "proj-1",
      productObjectId: "po-1",
      productObjectVersion: 2,
      title: "생성된 상세페이지",
      body: "# 생성된 상세페이지",
      status: "DRAFT",
      createdAt: "",
      updatedAt: "",
    });

    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/contents/generate")
      .send({ productObjectVersion: 2 })
      .expect(201);

    expect(response.body.title).toBe("생성된 상세페이지");
    expect(engine.generate).toHaveBeenCalledWith("proj-1", {
      productObjectVersion: 2,
    });
  });
  describe("발행 거버넌스 API (TASK-2501)", () => {
    /** 새 콘텐츠를 만들고 REVIEW로 올린다 */
    async function reviewed(body?: string) {
      const created = await request(app.getHttpServer())
        .post("/projects/proj-1/contents")
        .send({})
        .expect(201);
      const id = created.body.id as string;
      if (body !== undefined) {
        prismaMock.contents.get(id)!.body = body;
      }
      await request(app.getHttpServer())
        .patch(`/projects/proj-1/contents/${id}/status`)
        .set("Authorization", "Bearer editor-token")
        .send({ status: "REVIEW" })
        .expect(200);
      return id;
    }

    it("GET …/governance — 전이하지 않고 판정만 돌려준다", async () => {
      const id = await reviewed("깨끗한 매트입니다.");

      const response = await request(app.getHttpServer())
        .get(`/projects/proj-1/contents/${id}/governance`)
        .expect(200);

      expect(response.body.contentId).toBe(id);
      expect(response.body.contentStatus).toBe("REVIEW");
      expect(response.body.publishable).toBe(true);
      expect(
        response.body.checks.map((check: { key: string }) => check.key),
      ).toEqual([
        "content-body",
        "banned-words",
        "disclosures",
        "source-object",
        "related-rules",
      ]);
      // 각 항목이 막는 항목인지 화면이 추측하지 않게 밝힌다
      expect(
        response.body.checks.every(
          (check: { blocking?: boolean }) => typeof check.blocking === "boolean",
        ),
      ).toBe(true);
      // 상태는 그대로다 — 판정은 전이가 아니다
      expect(
        (
          await request(app.getHttpServer())
            .get(`/projects/proj-1/contents/${id}`)
            .expect(200)
        ).body.status,
      ).toBe("REVIEW");
    });

    it("미리보기가 막힌다고 하면 발행도 막힌다 — 같은 판정을 쓴다", async () => {
      const id = await reviewed("업계 1위 매트입니다.");

      const preview = await request(app.getHttpServer())
        .get(`/projects/proj-1/contents/${id}/governance`)
        .expect(200);
      expect(preview.body.publishable).toBe(false);
      expect(
        preview.body.blockers.map((check: { key: string }) => check.key),
      ).toEqual(["banned-words"]);

      const blocked = await request(app.getHttpServer())
        .patch(`/projects/proj-1/contents/${id}/status`)
        .set("Authorization", "Bearer editor-token")
        .send({ status: "PUBLISHED" })
        .expect(400);
      expect(blocked.body.message).toContain("1위");
    });

    it("GET …/governance/history — 막힌 기록도 남아 있다", async () => {
      const id = await reviewed("업계 1위 매트입니다.");
      await request(app.getHttpServer())
        .patch(`/projects/proj-1/contents/${id}/status`)
        .set("Authorization", "Bearer editor-token")
        .send({ status: "PUBLISHED" })
        .expect(400);

      prismaMock.contents.get(id)!.body = "깨끗한 매트입니다.";
      await request(app.getHttpServer())
        .patch(`/projects/proj-1/contents/${id}/status`)
        .set("Authorization", "Bearer editor-token")
        .send({ status: "PUBLISHED" })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/projects/proj-1/contents/${id}/governance/history`)
        .expect(200);

      expect(response.body.records).toHaveLength(2);
      // 최신순 — 통과한 기록이 먼저
      expect(response.body.records[0].published).toBe(true);
      expect(response.body.records[1].published).toBe(false);
      expect(response.body.records[1].blockedBy).toEqual(["banned-words"]);
      expect(response.body.records[1].actor).toBe("editor@acos.local");
    });

    it("없는 콘텐츠의 판정·이력 조회는 404", async () => {
      await request(app.getHttpServer())
        .get("/projects/proj-1/contents/none/governance")
        .expect(404);
      await request(app.getHttpServer())
        .get("/projects/proj-1/contents/none/governance/history")
        .expect(404);
    });
  });
});

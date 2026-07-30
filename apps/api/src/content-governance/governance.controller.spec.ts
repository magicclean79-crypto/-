import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthGuard } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  createPrismaMock,
  readyProductObject,
} from "../contents/contents.spec-helpers";
import { ContentGovernanceService } from "./content-governance.service";
import { GovernancePreflightService } from "./governance-preflight.service";
import { GovernanceRulesService } from "./governance-rules.service";
import { GovernanceController } from "./governance.controller";
import { createCompanyBrainMock } from "./governance.spec-helpers";

const DISCLOSURE = {
  id: "wash",
  text: "사용 후 물로 충분히 헹구세요.",
  whenCategory: "생활용품",
};

describe("Governance Preflight API (TASK-2601)", () => {
  let app: INestApplication;
  const prisma = createPrismaMock();

  beforeAll(async () => {
    prisma.productObjects.push({ ...readyProductObject });
    for (const [body, status] of [
      ["업계 1위 매트입니다. 사용 후 물로 충분히 헹구세요.", "REVIEW"],
      ["깨끗한 매트입니다.", "REVIEW"], // 고지 누락
      ["좋은 매트입니다. 사용 후 물로 충분히 헹구세요.", "REVIEW"], // 통과
      ["최고의 매트입니다. 사용 후 물로 충분히 헹구세요.", "PUBLISHED"], // 이미 나감
    ]) {
      await prisma.content.create({
        data: {
          projectId: "proj-1",
          productObjectId: "po-1",
          title: "매트",
          body,
          status,
        } as never,
      });
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [GovernanceController],
      providers: [
        GovernancePreflightService,
        ContentGovernanceService,
        GovernanceRulesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CompanyBrainService,
          useValue: createCompanyBrainMock({
            bannedWords: ["최고", "1위"],
            disclosures: [DISCLOSURE],
          }),
        },
        AuthGuard,
        {
          provide: AuthService,
          useValue: {
            validateToken: async (token: string) =>
              token === "admin-token"
                ? { id: "u-a", email: "admin@acos.local", role: "ADMIN" }
                : token === "editor-token"
                  ? { id: "u-e", email: "e@acos.local", role: "EDITOR" }
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

  it("GET /projects/:id/governance/preflight — 위반 목록을 돌려준다", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/governance/preflight")
      .expect(200);

    expect(response.body.projectId).toBe("proj-1");
    // 기본은 아직 나가지 않은 것만 (DRAFT·REVIEW)
    expect(response.body.summary.scanned).toBe(3);
    expect(response.body.summary.blocked).toBe(2);
    expect(response.body.summary.clean).toBe(1);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.detail).toContain("발행이 막힐 것 2건");
    // 상태를 바꾸지 않는다는 것을 응답 문구가 밝힌다
    expect(response.body.detail).toContain("상태를 바꾸지 않고");
  });

  it("검사별 집계로 무엇을 먼저 고칠지 알려준다", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/governance/preflight")
      .expect(200);
    expect(response.body.summary.byCheck).toEqual([
      { key: "banned-words", blocked: 1, warned: 0 },
      { key: "disclosures", blocked: 1, warned: 0 },
    ]);
  });

  it("?status=PUBLISHED로 이미 나간 위반을 드러낸다", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/governance/preflight?status=PUBLISHED")
      .expect(200);

    expect(response.body.summary.publishedViolations).toBe(1);
    expect(response.body.summary.blocked).toBe(0);
    expect(response.body.detail).toContain("이미 발행된 위반 1건");
    expect(response.body.detail).toContain("내려야 합니다");
  });

  it("스캔은 상태를 바꾸지 않는다", async () => {
    const before = [...prisma.contents.values()].map((row) => row.status);
    await request(app.getHttpServer())
      .get("/projects/proj-1/governance/preflight?status=DRAFT,REVIEW,PUBLISHED")
      .expect(200);
    expect([...prisma.contents.values()].map((row) => row.status)).toEqual(
      before,
    );
    expect(prisma.governanceChecks).toHaveLength(0);
  });

  it("잘못된 status·limit은 400 — 조용히 무시하지 않는다", async () => {
    await request(app.getHttpServer())
      .get("/projects/proj-1/governance/preflight?status=REVIEWED")
      .expect(400);
    await request(app.getHttpServer())
      .get("/projects/proj-1/governance/preflight?limit=0")
      .expect(400);
    await request(app.getHttpServer())
      .get("/projects/proj-1/governance/preflight?limit=abc")
      .expect(400);
  });

  it("limit으로 목록을 자르되 요약은 전체를 센다", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/governance/preflight?limit=1")
      .expect(200);

    expect(response.body.summary.blocked).toBe(2);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.truncated).toBe(true);
    expect(response.body.omitted).toBe(1);
    expect(response.body.detail).toContain("1건 생략");
  });

  it("없는 프로젝트는 404", async () => {
    await request(app.getHttpServer())
      .get("/projects/nope/governance/preflight")
      .expect(404);
  });

  it("전체 범위 스캔은 ADMIN 전용 — 프로젝트 경계를 넘는다", async () => {
    await request(app.getHttpServer())
      .get("/governance/preflight")
      .expect(401);
    await request(app.getHttpServer())
      .get("/governance/preflight")
      .set("Authorization", "Bearer editor-token")
      .expect(403);

    const response = await request(app.getHttpServer())
      .get("/governance/preflight")
      .set("Authorization", "Bearer admin-token")
      .expect(200);
    expect(response.body.projectId).toBeNull();
    expect(response.body.summary.scanned).toBe(3);
  });
});

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { GovernanceRulesService } from "../content-governance/governance-rules.service";
import { PrismaService } from "../prisma/prisma.service";
import { ReadyValidationController } from "./ready-validation.controller";
import { ReadyValidationService } from "./ready-validation.service";
import {
  createCompanyBrainMock,
  createPrismaMock,
  draftProductObject,
} from "./ready-validation.spec-helpers";

describe("READY Validation API (API Test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReadyValidationController],
      providers: [
        ReadyValidationService,
        GovernanceRulesService,
        {
          provide: PrismaService,
          useValue: createPrismaMock([draftProductObject]),
        },
        {
          provide: CompanyBrainService,
          useValue: createCompanyBrainMock({ bannedWords: ["최고", "1위"] }),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /projects/:id/ready-validation — 200, 판정과 6개 검사 반환", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/ready-validation")
      .send({})
      .expect(200);

    expect(response.body).toMatchObject({
      projectId: "proj-1",
      productObjectVersion: 3,
      status: "PASS",
    });
    expect(response.body.checks).toHaveLength(6);
    expect(
      response.body.checks.map((check: { key: string }) => check.key),
    ).toEqual([
      "transition",
      "requirements",
      "banned-words",
      "knowledge-rules",
      "decisions",
      "sop",
    ]);
  });

  it("없는 프로젝트 404 · 없는 버전 404 · 잘못된 버전 400", async () => {
    await request(app.getHttpServer())
      .post("/projects/nope/ready-validation")
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .post("/projects/proj-1/ready-validation")
      .send({ productObjectVersion: 9 })
      .expect(404);
    await request(app.getHttpServer())
      .post("/projects/proj-1/ready-validation")
      .send({ productObjectVersion: -1 })
      .expect(400);
  });
});

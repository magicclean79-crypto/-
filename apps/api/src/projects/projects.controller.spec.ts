import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { Project } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

describe("Projects API (API Test)", () => {
  let app: INestApplication;
  const rows = new Map<string, Project>();
  let sequence = 0;

  const prismaMock = {
    project: {
      create: jest.fn(async ({ data }: { data: Partial<Project> }) => {
        const now = new Date();
        const row = {
          id: `proj-${++sequence}`,
          description: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        } as Project;
        rows.set(row.id, row);
        return { ...row };
      }),
      findMany: jest.fn(async () =>
        [...rows.values()].map((row) => ({
          ...row,
          _count: { products: 2, productObjects: 3 },
        })),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        if (!row) return null;
        return {
          ...row,
          products: [],
          productObjects: [{ version: 3 }],
        };
      }),
      update: jest.fn(),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        rows.delete(where.id);
        return {};
      }),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /projects — 프로젝트를 생성한다", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects")
      .send({ name: "신제품 런칭" })
      .expect(201);

    expect(response.body).toMatchObject({ name: "신제품 런칭" });
    expect(response.body.id).toBeDefined();
  });

  it("POST /projects — 이름 없으면 400", async () => {
    await request(app.getHttpServer()).post("/projects").send({}).expect(400);
  });

  it("GET /projects — 목록 (상품/Product Object 수 포함)", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects")
      .expect(200);

    expect(response.body.projects.length).toBeGreaterThanOrEqual(1);
    expect(response.body.projects[0]).toMatchObject({
      productCount: 2,
      productObjectCount: 3,
    });
  });

  it("GET /projects/:id — 상세 (최신 Product Object 버전 포함)", async () => {
    const created = await request(app.getHttpServer())
      .post("/projects")
      .send({ name: "상세용" });

    const response = await request(app.getHttpServer())
      .get(`/projects/${created.body.id}`)
      .expect(200);

    expect(response.body.latestProductObjectVersion).toBe(3);
    expect(Array.isArray(response.body.products)).toBe(true);
  });

  it("GET /projects/:id — 없는 프로젝트는 404", async () => {
    await request(app.getHttpServer()).get("/projects/nope").expect(404);
  });

  it("DELETE /projects/:id — 삭제", async () => {
    const created = await request(app.getHttpServer())
      .post("/projects")
      .send({ name: "삭제용" });

    await request(app.getHttpServer())
      .delete(`/projects/${created.body.id}`)
      .expect(200);
  });
});

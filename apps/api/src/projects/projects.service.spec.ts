import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Project } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "./projects.service";

function createPrismaMock() {
  const rows = new Map<string, Project & Record<string, unknown>>();
  let sequence = 0;

  const prisma = {
    rows,
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
          _count: { products: 0, productObjects: 0 },
        })),
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) => {
          const row = rows.get(where.id);
          if (!row) return null;
          return { ...row, products: [], productObjects: [] };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Project>;
        }) => {
          const row = rows.get(where.id) as Project;
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        rows.delete(where.id);
        return {};
      }),
    },
  };
  return prisma;
}

describe("ProjectsService (Service Test)", () => {
  async function createService(prisma: ReturnType<typeof createPrismaMock>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return moduleRef.get(ProjectsService);
  }

  it("프로젝트를 생성한다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    const project = await service.create({
      name: "  신제품 런칭  ",
      description: "가을 신상",
    });

    expect(project.name).toBe("신제품 런칭");
    expect(project.description).toBe("가을 신상");
  });

  it("빈 이름은 400을 던진다", async () => {
    const service = await createService(createPrismaMock());
    await expect(service.create({ name: "   " })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("수정·삭제하고 없는 프로젝트는 404를 던진다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);
    const created = await service.create({ name: "이름" });

    const updated = await service.update(created.id, { name: "새 이름" });
    expect(updated.name).toBe("새 이름");

    await expect(service.update("nope", { name: "x" })).rejects.toThrow(
      NotFoundException,
    );

    await service.remove(created.id);
    expect(prisma.rows.size).toBe(0);
    await expect(service.remove(created.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("수정할 내용이 없으면 400을 던진다", async () => {
    const service = await createService(createPrismaMock());
    await expect(service.update("any", {})).rejects.toThrow(
      BadRequestException,
    );
  });
});

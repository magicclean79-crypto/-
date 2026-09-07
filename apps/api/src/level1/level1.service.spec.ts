import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { Level1Service } from "./level1.service";

function file(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: "actual-product.jpg",
    encoding: "7bit",
    mimetype: "image/jpeg",
    size: 12,
    buffer: Buffer.from("jpg"),
    stream: null as never,
    destination: "",
    filename: "actual-product.jpg",
    path: "",
    ...overrides,
  };
}

function createPrismaMock() {
  const projects = new Map<string, { id: string; name: string; createdAt: Date; updatedAt: Date }>();
  const products = new Map<string, Record<string, unknown>>();
  const assets = new Map<string, Record<string, unknown>>();
  let seq = 0;

  return {
    projects,
    products,
    assets,
    level1Project: {
      create: jest.fn(async ({ data }: { data: { name: string } }) => {
        const id = `proj-${++seq}`;
        const row = { id, name: data.name, createdAt: new Date(), updatedAt: new Date() };
        projects.set(id, row);
        return { ...row, _count: { products: 0 } };
      }),
      findMany: jest.fn(async () =>
        [...projects.values()].map((p) => ({
          ...p,
          _count: { products: [...products.values()].filter((x) => x.projectId === p.id).length },
        })),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const p = projects.get(where.id);
        if (!p) return null;
        return {
          ...p,
          _count: { products: [...products.values()].filter((x) => x.projectId === p.id).length },
        };
      }),
    },
    level1Product: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `prod-${++seq}`;
        const row = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
        products.set(id, row);
        return { ...row, _count: { assets: 0 } };
      }),
      findMany: jest.fn(async ({ where }: { where: { projectId: string } }) =>
        [...products.values()]
          .filter((p) => p.projectId === where.projectId)
          .map((p) => ({
            ...p,
            _count: { assets: [...assets.values()].filter((a) => a.productId === p.id).length },
          })),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const p = products.get(where.id);
        if (!p) return null;
        return {
          ...p,
          _count: { assets: [...assets.values()].filter((a) => a.productId === p.id).length },
        };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = products.get(where.id);
        if (!existing) throw new Error("not found");
        const merged = { ...existing };
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) merged[key] = value;
        }
        merged.updatedAt = new Date();
        products.set(where.id, merged);
        return {
          ...merged,
          _count: { assets: [...assets.values()].filter((a) => a.productId === where.id).length },
        };
      }),
    },
    level1Asset: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `asset-${++seq}`;
        const row = { id, roleSetAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        assets.set(id, row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: { productId: string } }) =>
        [...assets.values()].filter((a) => a.productId === where.productId),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => assets.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = assets.get(where.id);
        if (!existing) throw new Error("not found");
        const merged = { ...existing, ...data, updatedAt: new Date() };
        assets.set(where.id, merged);
        return merged;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const existing = assets.get(where.id);
        assets.delete(where.id);
        return existing;
      }),
    },
  };
}

function createStorageMock() {
  const store = new Map<string, Buffer>();
  return {
    store,
    putObject: jest.fn(async (key: string, buffer: Buffer) => {
      store.set(key, buffer);
      return `https://s3.local/${key}`;
    }),
    getObject: jest.fn(async (key: string) => store.get(key) ?? Buffer.alloc(0)),
    removeObjects: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => store.delete(key));
    }),
  };
}

async function createService(
  prisma: ReturnType<typeof createPrismaMock>,
  storage: ReturnType<typeof createStorageMock>,
) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      Level1Service,
      { provide: PrismaService, useValue: prisma },
      { provide: StorageService, useValue: storage },
    ],
  }).compile();
  return moduleRef.get(Level1Service);
}

describe("Level1Service — 프로젝트/제품", () => {
  it("프로젝트를 만들고 목록에서 본다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma, createStorageMock());

    const project = await service.createProject({ name: "베란다 호스" });
    expect(project.name).toBe("베란다 호스");
    expect(project.productCount).toBe(0);

    const list = await service.listProjects();
    expect(list).toHaveLength(1);
  });

  it("이름이 비어 있으면 프로젝트 생성을 거절한다", async () => {
    const service = await createService(createPrismaMock(), createStorageMock());
    await expect(service.createProject({ name: "   " })).rejects.toThrow(BadRequestException);
  });

  it("확인된 사실만 그대로 저장한다 — 빈 값을 채우지 않는다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma, createStorageMock());
    const project = await service.createProject({ name: "테스트" });

    const product = await service.createProduct(project.id, { brand: "  삼정글로벌  " });
    expect(product.brand).toBe("삼정글로벌");
    expect(product.name).toBeNull();
    expect(product.materials).toEqual([]);
    expect(product.source).toBe("manual");
  });

  it("uncertainFields에 알 수 없는 필드가 있으면 거절한다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma, createStorageMock());
    const project = await service.createProject({ name: "테스트" });

    await expect(
      service.createProduct(project.id, { uncertainFields: ["notAField"] }),
    ).rejects.toThrow(BadRequestException);
  });

  it("없는 프로젝트에 제품을 만들면 404", async () => {
    const service = await createService(createPrismaMock(), createStorageMock());
    await expect(service.createProduct("nope", { name: "x" })).rejects.toThrow(NotFoundException);
  });

  it("PATCH는 보낸 필드만 바꾼다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma, createStorageMock());
    const project = await service.createProject({ name: "테스트" });
    const product = await service.createProduct(project.id, { name: "원래이름", brand: "원래브랜드" });

    const updated = await service.updateProduct(product.id, { name: "새이름" });
    expect(updated.name).toBe("새이름");
    expect(updated.brand).toBe("원래브랜드");
  });
});

describe("Level1Service — asset", () => {
  it("업로드하면 MinIO에 저장되고 role은 UNKNOWN으로 시작한다", async () => {
    const prisma = createPrismaMock();
    const storage = createStorageMock();
    const service = await createService(prisma, storage);
    const project = await service.createProject({ name: "테스트" });
    const product = await service.createProduct(project.id, {});

    const asset = await service.uploadAsset(product.id, file());
    expect(asset.role).toBe("UNKNOWN");
    expect(asset.objectKey).toMatch(new RegExp(`^level1/${product.id}/`));
    expect(storage.putObject).toHaveBeenCalled();
  });

  it("역할을 사람이 직접 정한다 — manual로 기록된다", async () => {
    const prisma = createPrismaMock();
    const storage = createStorageMock();
    const service = await createService(prisma, storage);
    const project = await service.createProject({ name: "테스트" });
    const product = await service.createProduct(project.id, {});
    const asset = await service.uploadAsset(product.id, file());

    const updated = await service.updateAssetRole(asset.id, "ACTUAL_PRODUCT");
    expect(updated.role).toBe("ACTUAL_PRODUCT");
    expect(updated.roleSetBy).toBe("manual");
    expect(updated.roleSetAt).not.toBeNull();
  });

  it("정해지지 않은 role 값은 거절한다", async () => {
    const prisma = createPrismaMock();
    const storage = createStorageMock();
    const service = await createService(prisma, storage);
    const project = await service.createProject({ name: "테스트" });
    const product = await service.createProduct(project.id, {});
    const asset = await service.uploadAsset(product.id, file());

    await expect(service.updateAssetRole(asset.id, "HERO")).rejects.toThrow(BadRequestException);
  });

  it("지원하지 않는 파일 형식은 저장소에 손대기 전에 거절한다", async () => {
    const prisma = createPrismaMock();
    const storage = createStorageMock();
    const service = await createService(prisma, storage);
    const project = await service.createProject({ name: "테스트" });
    const product = await service.createProduct(project.id, {});

    await expect(
      service.uploadAsset(product.id, file({ mimetype: "application/pdf" })),
    ).rejects.toThrow(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("삭제하면 DB와 오브젝트 저장소 양쪽에서 사라진다", async () => {
    const prisma = createPrismaMock();
    const storage = createStorageMock();
    const service = await createService(prisma, storage);
    const project = await service.createProject({ name: "테스트" });
    const product = await service.createProduct(project.id, {});
    const asset = await service.uploadAsset(product.id, file());

    await service.deleteAsset(asset.id);
    expect(storage.store.has(asset.objectKey)).toBe(false);
    await expect(service.getAssetFile(asset.id)).rejects.toThrow(NotFoundException);
  });
});

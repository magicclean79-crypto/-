import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { UploadsService } from "./uploads.service";

function file(name = "a.png"): Express.Multer.File {
  return {
    fieldname: "files",
    originalname: name,
    encoding: "7bit",
    mimetype: "image/png",
    size: 12,
    buffer: Buffer.from("png"),
    stream: null as never,
    destination: "",
    filename: name,
    path: "",
  };
}

function createPrismaMock(projects: string[] = ["clx0000000000000000000001"]) {
  const created: Record<string, unknown>[] = [];
  return {
    created,
    project: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        projects.includes(where.id) ? { id: where.id } : null,
      ),
    },
    image: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `img-${created.length + 1}`,
          productId: null,
          projectId: null,
          ...data,
          createdAt: new Date(),
        };
        created.push(row);
        return row;
      }),
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
}

describe("UploadsService — 업로드 단계 귀속 (TASK-4501, 정책 4501-②)", () => {
  async function createService(prisma: ReturnType<typeof createPrismaMock>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: {
            putObject: jest.fn(async (key: string) => `https://s3.local/${key}`),
            removeObjects: jest.fn(async () => undefined),
          },
        },
      ],
    }).compile();
    return moduleRef.get(UploadsService);
  }

  it("밝힌 소속을 이미지에 적는다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    const images = await service.uploadImages(
      [file()],
      "clx0000000000000000000001",
    );
    expect(images[0].projectId).toBe("clx0000000000000000000001");
  });

  it("밝히지 않은 것은 잘못이 아니다 — null로 남는다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    const images = await service.uploadImages([file()]);
    expect(images[0].projectId).toBeNull();
  });

  /**
   * 조용히 버리면 사용자는 소속을 밝혔다고 믿는데 기록은 미귀속이다 —
   * 그 차이는 몇 주 뒤 비용 보고에서야 드러난다.
   */
  it("없는 프로젝트는 거절한다 — 조용히 버리지 않는다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    await expect(
      service.uploadImages([file()], "clx0000000000000000000009"),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.created).toHaveLength(0);
  });

  it("프로젝트 id 모양이 아니면 거절한다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    await expect(service.uploadImages([file()], "우리 프로젝트")).rejects.toThrow(
      BadRequestException,
    );
  });

  /**
   * 확인은 파일을 올리기 전에 한다 — 거절할 것을 올려 두면 고아 파일이 남는다.
   */
  it("거절할 업로드는 저장소에 손대기 전에 막는다", async () => {
    const prisma = createPrismaMock();
    const storage = { putObject: jest.fn(), removeObjects: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    const service = moduleRef.get(UploadsService);

    await expect(
      service.uploadImages([file()], "clx0000000000000000000009"),
    ).rejects.toThrow(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});

describe("UploadsService.getImageFile — 생성 이력의 '사용된 사진' 표시용", () => {
  it("이미지 바이트와 mimeType을 저장소에서 그대로 가져온다", async () => {
    const prisma = {
      image: {
        findUnique: jest.fn(async () => ({
          id: "img-1",
          key: "images/2026/08/a.png",
          mimeType: "image/png",
        })),
      },
    };
    const storage = { getObject: jest.fn(async () => Buffer.from("bytes")) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    const service = moduleRef.get(UploadsService);

    const result = await service.getImageFile("img-1");
    expect(result.mimeType).toBe("image/png");
    expect(result.buffer.toString()).toBe("bytes");
    expect(storage.getObject).toHaveBeenCalledWith("images/2026/08/a.png");
  });

  it("없는 이미지는 404를 던진다", async () => {
    const prisma = { image: { findUnique: jest.fn(async () => null) } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: { getObject: jest.fn() } },
      ],
    }).compile();
    const service = moduleRef.get(UploadsService);

    await expect(service.getImageFile("nope")).rejects.toThrow(NotFoundException);
  });
});

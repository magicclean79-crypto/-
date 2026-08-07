import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { checkUploadProject } from "@acos/core";
import type { ImageDto } from "@acos/shared";
import type { Image } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** multer는 파일 이름을 latin1로 넘기므로 UTF-8(한글 등)로 복원한다. */
function decodeOriginalName(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}

function toDto(image: Image): ImageDto {
  return {
    id: image.id,
    key: image.key,
    url: image.url,
    originalName: image.originalName,
    mimeType: image.mimeType,
    size: image.size,
    productId: image.productId,
    projectId: image.projectId,
    createdAt: image.createdAt.toISOString(),
    kind: image.kind as ImageDto["kind"],
    sourceImageId: image.sourceImageId,
    generationMetadata: image.generationMetadata as ImageDto["generationMetadata"],
  };
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * @param projectId 업로드하는 사람이 밝힌 소속 (TASK-4501, CTO 정책 4501-②).
   *   선택 값이지만 **적혔다면 반드시 확인합니다** — 없는 프로젝트 id를 조용히
   *   버리면 사용자는 소속을 밝혔다고 믿는데 기록에는 미귀속으로 남고, 그
   *   차이는 몇 주 뒤 비용 보고에서야 드러납니다.
   */
  async uploadImages(
    files: Express.Multer.File[],
    projectId?: string | null,
  ): Promise<ImageDto[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException("업로드할 파일이 없습니다.");
    }

    const project = await this.resolveProject(projectId);

    const stored: {
      key: string;
      url: string;
      originalName: string;
      mimeType: string;
      size: number;
    }[] = [];

    for (const file of files) {
      const extension = EXTENSION_BY_MIME[file.mimetype];
      if (!extension) {
        throw new BadRequestException(
          `지원하지 않는 파일 형식입니다: ${file.mimetype}`,
        );
      }
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const key = `images/${yyyy}/${mm}/${randomUUID()}.${extension}`;
      const url = await this.storage.putObject(key, file.buffer, file.mimetype);

      stored.push({
        key,
        url,
        originalName: decodeOriginalName(file.originalname),
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    try {
      const records = await this.prisma.$transaction(
        stored.map((item) =>
          this.prisma.image.create({ data: { ...item, projectId: project } }),
        ),
      );
      return records.map(toDto);
    } catch (error) {
      this.logger.error("Failed to persist uploaded images", error as Error);
      // DB 저장에 실패하면 이미 올라간 오브젝트를 정리해 고아 파일을 남기지 않는다.
      await this.storage.removeObjects(stored.map((item) => item.key));
      throw new ServiceUnavailableException(
        "데이터베이스에 저장할 수 없습니다. PostgreSQL이 실행 중인지 확인해 주세요. (pnpm docker:up)",
      );
    }
  }

  /**
   * 밝힌 소속을 확인한다 (TASK-4501, CTO 정책 4501-②).
   *
   * 판정은 core가 하고 여기서는 **존재 여부만 읽어다 줍니다.** 조회가 실패하면
   * 통과시키지 않고 그대로 실패시킵니다 — "확인 못 했으니 일단 받자"는
   * 확인하지 않은 값을 확인한 값과 같은 자리에 넣는 일입니다.
   */
  private async resolveProject(raw?: string | null): Promise<string | null> {
    const value = raw?.trim();
    if (!value) {
      return null;
    }
    const found = await this.prisma.project.findUnique({
      where: { id: value },
      select: { id: true },
    });
    const check = checkUploadProject(
      value,
      new Set(found ? [found.id] : []),
    );
    if (check.verdict !== "accepted") {
      throw new BadRequestException(check.detail);
    }
    return check.projectId;
  }

  /**
   * 이미지 바이트를 id로 다시 가져온다 (Product Detail Engine 생성 이력
   * 화면의 "사용된 사진" 표시용). `ImageDto.url`은 고정 공개 URL이지만
   * 운영 버킷은 계정 단위 Public Access Block이 켜져 있을 수 있어(§4-9
   * 관측) 항상 접근 가능하다고 보장할 수 없다 — 인증된 우리 서버를 거쳐
   * 항상 같은 방식으로 보여준다.
   */
  async getImageFile(id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const image = await this.prisma.image.findUnique({ where: { id } });
    if (!image) {
      throw new NotFoundException(`이미지를 찾을 수 없습니다: ${id}`);
    }
    const buffer = await this.storage.getObject(image.key);
    return { buffer, mimeType: image.mimeType };
  }

  async listImages(take: number): Promise<ImageDto[]> {
    const bounded = Math.min(Math.max(Number.isFinite(take) ? take : 20, 1), 100);
    try {
      const records = await this.prisma.image.findMany({
        orderBy: { createdAt: "desc" },
        take: bounded,
      });
      return records.map(toDto);
    } catch {
      throw new ServiceUnavailableException(
        "데이터베이스에 연결할 수 없습니다. PostgreSQL이 실행 중인지 확인해 주세요.",
      );
    }
  }
}

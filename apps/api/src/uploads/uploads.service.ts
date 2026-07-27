import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
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
    createdAt: image.createdAt.toISOString(),
  };
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async uploadImages(files: Express.Multer.File[]): Promise<ImageDto[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException("업로드할 파일이 없습니다.");
    }

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
        stored.map((item) => this.prisma.image.create({ data: item })),
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

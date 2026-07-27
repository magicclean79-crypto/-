import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateProductRequest,
  ImageWithOcrDto,
  ProductDetailDto,
  ProductListItemDto,
  UpdateProductRequest,
} from "@acos/shared";
import type { Image, OcrResult, Product } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const NAME_MAX_LENGTH = 200;
const DEFAULT_NAME = "새 상품";

type ImageWithOcr = Image & { ocrResults: OcrResult[] };
type ProductWithImages = Product & { images: ImageWithOcr[] };

/** 이미지의 최신 OCR 실행 1건 (include에서 최신순 take 1로 조회됨) */
function latestOcr(image: ImageWithOcr): OcrResult | null {
  return image.ocrResults[0] ?? null;
}

function toImageDto(image: ImageWithOcr): ImageWithOcrDto {
  const ocr = latestOcr(image);
  return {
    id: image.id,
    key: image.key,
    url: image.url,
    originalName: image.originalName,
    mimeType: image.mimeType,
    size: image.size,
    productId: image.productId,
    createdAt: image.createdAt.toISOString(),
    ocr: ocr
      ? {
          status: ocr.status,
          confidence: ocr.confidence,
          extractedText: ocr.extractedText,
        }
      : null,
  };
}

function toDetailDto(product: ProductWithImages): ProductDetailDto {
  return {
    id: product.id,
    projectId: product.projectId,
    name: product.name,
    description: product.description,
    images: product.images.map(toImageDto),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

/**
 * 상품 이름이 주어지지 않았을 때 결정적 규칙으로 초안 이름을 만든다.
 * 1) 완료된 OCR 텍스트의 첫 줄 → 2) 첫 이미지 파일명(확장자 제거) → 3) 기본값
 */
function deriveName(images: ImageWithOcr[]): string {
  for (const image of images) {
    const ocr = latestOcr(image);
    const text = ocr?.status === "SUCCESS" ? ocr.extractedText : null;
    const firstLine = text
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine) {
      return firstLine.slice(0, NAME_MAX_LENGTH);
    }
  }
  const fileName = images[0]?.originalName.replace(/\.[^.]+$/, "").trim();
  return fileName || DEFAULT_NAME;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(request: CreateProductRequest): Promise<ProductDetailDto> {
    const name = request.name?.trim();
    if (name !== undefined && (name.length === 0 || name.length > NAME_MAX_LENGTH)) {
      throw new BadRequestException(
        `이름은 1~${NAME_MAX_LENGTH}자여야 합니다.`,
      );
    }
    const imageIds = request.imageIds ?? [];
    if (!Array.isArray(imageIds)) {
      throw new BadRequestException("imageIds는 배열이어야 합니다.");
    }

    let images: ImageWithOcr[] = [];
    if (imageIds.length > 0) {
      images = await this.prisma.image.findMany({
        where: { id: { in: imageIds } },
        include: {
          ocrResults: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      const foundIds = new Set(images.map((image) => image.id));
      const missing = imageIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `존재하지 않는 이미지입니다: ${missing.join(", ")}`,
        );
      }
      const taken = images.filter((image) => image.productId !== null);
      if (taken.length > 0) {
        throw new BadRequestException(
          `이미 다른 상품에 연결된 이미지입니다: ${taken
            .map((image) => image.id)
            .join(", ")}`,
        );
      }
    }

    // 소속 프로젝트 확인 — 미지정이면 상품 이름으로 자동 생성한다 (TASK-0301)
    if (request.projectId) {
      const projectExists = await this.prisma.project.findUnique({
        where: { id: request.projectId },
        select: { id: true },
      });
      if (!projectExists) {
        throw new BadRequestException(
          `존재하지 않는 프로젝트입니다: ${request.projectId}`,
        );
      }
    }

    const product = await this.prisma.$transaction(async (tx) => {
      const resolvedName = name ?? deriveName(images);
      const projectId =
        request.projectId ??
        (
          await tx.project.create({
            data: {
              name: resolvedName,
              description: request.description?.trim() || null,
            },
            select: { id: true },
          })
        ).id;
      const created = await tx.product.create({
        data: {
          projectId,
          name: resolvedName,
          description: request.description?.trim() || null,
        },
      });
      if (imageIds.length > 0) {
        await tx.image.updateMany({
          where: { id: { in: imageIds } },
          data: { productId: created.id },
        });
      }
      return tx.product.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          images: {
            include: {
              ocrResults: { orderBy: { createdAt: "desc" }, take: 1 },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });
    });
    return toDetailDto(product);
  }

  async list(take: number): Promise<ProductListItemDto[]> {
    const bounded = Math.min(
      Math.max(Number.isFinite(take) ? take : 20, 1),
      100,
    );
    const products = await this.prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      take: bounded,
      include: {
        images: { orderBy: { createdAt: "asc" }, take: 1 },
        _count: { select: { images: true } },
      },
    });
    return products.map((product) => ({
      id: product.id,
      projectId: product.projectId,
      name: product.name,
      description: product.description,
      imageCount: product._count.images,
      thumbnailUrl: product.images[0]?.url ?? null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    }));
  }

  async getById(id: string): Promise<ProductDetailDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: {
          include: {
            ocrResults: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!product) {
      throw new NotFoundException(`상품을 찾을 수 없습니다: ${id}`);
    }
    return toDetailDto(product);
  }

  async update(
    id: string,
    request: UpdateProductRequest,
  ): Promise<ProductDetailDto> {
    const data: { name?: string; description?: string | null } = {};
    if (request.name !== undefined) {
      const name = request.name.trim();
      if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
        throw new BadRequestException(
          `이름은 1~${NAME_MAX_LENGTH}자여야 합니다.`,
        );
      }
      data.name = name;
    }
    if (request.description !== undefined) {
      data.description = request.description?.trim() || null;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("수정할 내용이 없습니다.");
    }

    await this.getById(id);
    await this.prisma.product.update({ where: { id }, data });
    return this.getById(id);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    await this.getById(id);
    // 이미지는 삭제하지 않고 연결만 해제된다. (FK onDelete: SetNull)
    await this.prisma.product.delete({ where: { id } });
    return { deleted: true };
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  isLevel1AssetRole,
  sanitizeLevel1ProductFacts,
  validateLevel1ProductFacts,
} from "@acos/core";
import type {
  CreateLevel1ProjectRequest,
  Level1AssetDto,
  Level1ProductDto,
  Level1ProjectDto,
  UpsertLevel1ProductRequest,
} from "@acos/shared";
import type {
  Level1Asset,
  Level1Product,
  Level1Project,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

/** 업로드 허용 MIME — 실제 제품 사진 보관이 목적이라 일반 이미지 형식만 받는다 */
const ALLOWED_ASSET_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** multer는 파일 이름을 latin1로 넘긴다 — 업로드 서비스와 같은 이유(uploads.service.ts) */
function decodeOriginalName(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}

function toProjectDto(
  project: Level1Project & { _count: { products: number } },
): Level1ProjectDto {
  return {
    id: project.id,
    name: project.name,
    productCount: project._count.products,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toProductDto(
  product: Level1Product & { _count: { assets: number } },
): Level1ProductDto {
  return {
    id: product.id,
    projectId: product.projectId,
    name: product.name,
    brand: product.brand,
    model: product.model,
    category: product.category,
    materials: product.materials,
    colors: product.colors,
    dimensions: product.dimensions,
    includedComponents: product.includedComponents,
    origin: product.origin,
    claims: product.claims,
    source: product.source,
    uncertainFields: product.uncertainFields,
    notes: product.notes,
    assetCount: product._count.assets,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function toAssetDto(asset: Level1Asset): Level1AssetDto {
  return {
    id: asset.id,
    productId: asset.productId,
    objectKey: asset.objectKey,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    size: asset.size,
    role: asset.role,
    roleSetBy: asset.roleSetBy,
    roleSetAt: asset.roleSetAt ? asset.roleSetAt.toISOString() : null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

/**
 * Product Detail Engine LEVEL 1 (T1-188).
 *
 * 기존 ProductProfileService/ProductsService 등 기존 파이프라인 코드를
 * 재사용하지 않는다 — DB(Prisma)·오브젝트 저장소(StorageService)만
 * 기존 인프라 어댑터로 그대로 쓴다. 디자인·이미지 생성은 다루지 않는다.
 */
@Injectable()
export class Level1Service {
  private readonly logger = new Logger(Level1Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ── Project ──────────────────────────────────────────────

  async createProject(body: CreateLevel1ProjectRequest): Promise<Level1ProjectDto> {
    const name = body?.name?.trim();
    if (!name) {
      throw new BadRequestException("name은 비어 있을 수 없습니다.");
    }
    const project = await this.prisma.level1Project.create({
      data: { name },
      include: { _count: { select: { products: true } } },
    });
    return toProjectDto(project);
  }

  async listProjects(): Promise<Level1ProjectDto[]> {
    const projects = await this.withDbErrorHandling(() =>
      this.prisma.level1Project.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { products: true } } },
      }),
    );
    return projects.map(toProjectDto);
  }

  async getProject(id: string): Promise<Level1ProjectDto> {
    const project = await this.prisma.level1Project.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!project) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${id}`);
    }
    return toProjectDto(project);
  }

  private async requireProject(id: string): Promise<void> {
    const exists = await this.prisma.level1Project.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${id}`);
    }
  }

  // ── Product ──────────────────────────────────────────────

  async createProduct(
    projectId: string,
    body: UpsertLevel1ProductRequest,
  ): Promise<Level1ProductDto> {
    await this.requireProject(projectId);
    const validation = validateLevel1ProductFacts(body ?? {});
    if (!validation.ok) {
      throw new BadRequestException(validation.errors.join(" "));
    }
    const sanitized = sanitizeLevel1ProductFacts(body ?? {});
    const product = await this.prisma.level1Product.create({
      data: {
        projectId,
        name: sanitized.name ?? null,
        brand: sanitized.brand ?? null,
        model: sanitized.model ?? null,
        category: sanitized.category ?? null,
        materials: sanitized.materials ?? [],
        colors: sanitized.colors ?? [],
        dimensions: sanitized.dimensions ?? null,
        includedComponents: sanitized.includedComponents ?? [],
        origin: sanitized.origin ?? null,
        claims: sanitized.claims ?? [],
        uncertainFields: sanitized.uncertainFields ?? [],
        notes: sanitized.notes ?? null,
        // LEVEL 1은 항상 사람이 직접 입력한 사실만 다룬다 — DB 기본값에
        // 기대지 않고 명시한다(다음 레벨에서 다른 출처가 생기면 이 값을
        // 실제로 고를 지점이다).
        source: "manual",
      },
      include: { _count: { select: { assets: true } } },
    });
    return toProductDto(product);
  }

  async listProducts(projectId: string): Promise<Level1ProductDto[]> {
    await this.requireProject(projectId);
    const products = await this.prisma.level1Product.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { assets: true } } },
    });
    return products.map(toProductDto);
  }

  async getProduct(id: string): Promise<Level1ProductDto> {
    const product = await this.findProductOrThrow(id);
    return toProductDto(product);
  }

  async updateProduct(
    id: string,
    body: UpsertLevel1ProductRequest,
  ): Promise<Level1ProductDto> {
    await this.findProductOrThrow(id);
    const validation = validateLevel1ProductFacts(body ?? {});
    if (!validation.ok) {
      throw new BadRequestException(validation.errors.join(" "));
    }
    const sanitized = sanitizeLevel1ProductFacts(body ?? {});
    // undefined인 필드는 건드리지 않는다 (PATCH 의미론) — Prisma는
    // undefined 값을 가진 키를 update에서 자동으로 건너뛴다.
    const product = await this.prisma.level1Product.update({
      where: { id },
      data: { ...sanitized },
      include: { _count: { select: { assets: true } } },
    });
    return toProductDto(product);
  }

  private async findProductOrThrow(
    id: string,
  ): Promise<Level1Product & { _count: { assets: number } }> {
    const product = await this.prisma.level1Product.findUnique({
      where: { id },
      include: { _count: { select: { assets: true } } },
    });
    if (!product) {
      throw new NotFoundException(`제품을 찾을 수 없습니다: ${id}`);
    }
    return product;
  }

  // ── Asset ────────────────────────────────────────────────

  async uploadAsset(
    productId: string,
    file: Express.Multer.File | undefined,
  ): Promise<Level1AssetDto> {
    if (!file) {
      throw new BadRequestException("업로드할 파일이 없습니다.");
    }
    if (!ALLOWED_ASSET_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `지원하지 않는 파일 형식입니다: ${file.mimetype}`,
      );
    }
    const product = await this.prisma.level1Product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(`제품을 찾을 수 없습니다: ${productId}`);
    }

    const extension = EXTENSION_BY_MIME[file.mimetype];
    // 기존 이미지(images/...)와 절대 섞이지 않도록 key를 level1/ 아래로 분리한다
    const key = `level1/${productId}/${randomUUID()}.${extension}`;
    await this.storage.putObject(key, file.buffer, file.mimetype);

    try {
      const asset = await this.prisma.level1Asset.create({
        data: {
          productId,
          objectKey: key,
          originalName: decodeOriginalName(file.originalname),
          mimeType: file.mimetype,
          size: file.size,
          role: "UNKNOWN",
        },
      });
      return toAssetDto(asset);
    } catch (error) {
      this.logger.error(`Failed to persist Level1 asset "${key}"`, error as Error);
      await this.storage.removeObjects([key]);
      throw new ServiceUnavailableException(
        "데이터베이스에 저장할 수 없습니다. PostgreSQL이 실행 중인지 확인해 주세요.",
      );
    }
  }

  async listAssets(productId: string): Promise<Level1AssetDto[]> {
    await this.findProductOrThrow(productId);
    const assets = await this.prisma.level1Asset.findMany({
      where: { productId },
      orderBy: { createdAt: "asc" },
    });
    return assets.map(toAssetDto);
  }

  async getAssetFile(id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const asset = await this.prisma.level1Asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException(`asset을 찾을 수 없습니다: ${id}`);
    }
    const buffer = await this.storage.getObject(asset.objectKey);
    return { buffer, mimeType: asset.mimeType };
  }

  async updateAssetRole(id: string, role: unknown): Promise<Level1AssetDto> {
    if (!isLevel1AssetRole(role)) {
      throw new BadRequestException(
        "role이 올바르지 않습니다. (ACTUAL_PRODUCT/PACKAGING/LABEL/SPEC/BARCODE/MANUAL/LIFESTYLE/UNKNOWN 중 하나)",
      );
    }
    const exists = await this.prisma.level1Asset.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`asset을 찾을 수 없습니다: ${id}`);
    }
    const asset = await this.prisma.level1Asset.update({
      where: { id },
      data: { role, roleSetBy: "manual", roleSetAt: new Date() },
    });
    return toAssetDto(asset);
  }

  async deleteAsset(id: string): Promise<void> {
    const asset = await this.prisma.level1Asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException(`asset을 찾을 수 없습니다: ${id}`);
    }
    await this.prisma.level1Asset.delete({ where: { id } });
    await this.storage.removeObjects([asset.objectKey]);
  }

  private async withDbErrorHandling<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error("Level1 DB 조회 실패", error as Error);
      throw new ServiceUnavailableException(
        "데이터베이스에 연결할 수 없습니다. PostgreSQL이 실행 중인지 확인해 주세요.",
      );
    }
  }
}

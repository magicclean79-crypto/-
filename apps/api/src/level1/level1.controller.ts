import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type {
  CreateLevel1ProjectRequest,
  Level1AssetDto,
  Level1ProductDto,
  Level1ProjectDto,
  UpdateLevel1AssetRoleRequest,
  UpsertLevel1ProductRequest,
} from "@acos/shared";
import { PublicInDev } from "../auth/write-protection.guard";
import { Level1Service } from "./level1.service";

/**
 * Product Detail Engine LEVEL 1 (T1-188) — 새 상세페이지 생성 프로그램의
 * 최소 기반. 제품 사실 입력 + 실제 제품 사진 asset 보관만 다룬다.
 *
 * 과금 호출이 전혀 없는 순수 CRUD라 `@PublicInDev()`로 로컬 검증을
 * 로그인 없이 열어 둔다(운영/스테이징에서는 그대로 인증 요구,
 * product-profile.controller.ts와 같은 이유).
 */
@Controller("level1")
export class Level1Controller {
  constructor(private readonly service: Level1Service) {}

  @Post("projects")
  @PublicInDev()
  createProject(@Body() body: CreateLevel1ProjectRequest): Promise<Level1ProjectDto> {
    return this.service.createProject(body);
  }

  @Get("projects")
  listProjects(): Promise<Level1ProjectDto[]> {
    return this.service.listProjects();
  }

  @Get("projects/:id")
  getProject(@Param("id") id: string): Promise<Level1ProjectDto> {
    return this.service.getProject(id);
  }

  @Post("projects/:id/products")
  @PublicInDev()
  createProduct(
    @Param("id") projectId: string,
    @Body() body: UpsertLevel1ProductRequest,
  ): Promise<Level1ProductDto> {
    return this.service.createProduct(projectId, body);
  }

  @Get("projects/:id/products")
  listProducts(@Param("id") projectId: string): Promise<Level1ProductDto[]> {
    return this.service.listProducts(projectId);
  }

  @Get("products/:id")
  getProduct(@Param("id") id: string): Promise<Level1ProductDto> {
    return this.service.getProduct(id);
  }

  @Patch("products/:id")
  @PublicInDev()
  updateProduct(
    @Param("id") id: string,
    @Body() body: UpsertLevel1ProductRequest,
  ): Promise<Level1ProductDto> {
    return this.service.updateProduct(id, body);
  }

  @Post("products/:id/assets")
  @PublicInDev()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadAsset(
    @Param("id") productId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<Level1AssetDto> {
    return this.service.uploadAsset(productId, file);
  }

  @Get("products/:id/assets")
  listAssets(@Param("id") productId: string): Promise<Level1AssetDto[]> {
    return this.service.listAssets(productId);
  }

  @Get("assets/:id/file")
  async getAssetFile(@Param("id") id: string): Promise<StreamableFile> {
    const { buffer, mimeType } = await this.service.getAssetFile(id);
    return new StreamableFile(buffer, { type: mimeType });
  }

  @Patch("assets/:id/role")
  @PublicInDev()
  updateAssetRole(
    @Param("id") id: string,
    @Body() body: UpdateLevel1AssetRoleRequest,
  ): Promise<Level1AssetDto> {
    return this.service.updateAssetRole(id, body?.role);
  }

  @Delete("assets/:id")
  @PublicInDev()
  async deleteAsset(@Param("id") id: string): Promise<{ ok: true }> {
    await this.service.deleteAsset(id);
    return { ok: true };
  }
}

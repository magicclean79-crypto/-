import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { ProductObjectDto } from "@acos/shared";
import { ProductObjectService } from "./product-object.service";

function parseVersion(version: string): number {
  const parsed = Number(version);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException("version은 1 이상의 정수여야 합니다.");
  }
  return parsed;
}

@Controller("projects/:projectId/product-object")
export class ProductObjectController {
  constructor(private readonly productObjectService: ProductObjectService) {}

  /** OCR + Vision(mock) 결과를 조립해 새 버전의 Product Object 생성 */
  @Post()
  async create(
    @Param("projectId") projectId: string,
  ): Promise<ProductObjectDto> {
    return this.productObjectService.buildAndCreate(projectId);
  }

  /** 최신 Product Object 조회 (?version=N 으로 특정 버전) */
  @Get()
  async get(
    @Param("projectId") projectId: string,
    @Query("version") version?: string,
  ): Promise<ProductObjectDto> {
    let parsed: number | undefined;
    if (version !== undefined) {
      parsed = Number(version);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new BadRequestException("version은 1 이상의 정수여야 합니다.");
      }
    }
    return this.productObjectService.getByProjectId(projectId, parsed);
  }

  /** 상태 전이 (DRAFT ⇄ READY, → ARCHIVED) */
  @Patch(":version/status")
  async updateStatus(
    @Param("projectId") projectId: string,
    @Param("version") version: string,
    @Body() body?: { status?: string },
  ): Promise<ProductObjectDto> {
    if (!body?.status) {
      throw new BadRequestException("status는 필수입니다.");
    }
    return this.productObjectService.updateStatus(
      projectId,
      parseVersion(version),
      body.status,
    );
  }

  /** 버전 이력 (최신순) */
  @Get("history")
  async history(
    @Param("projectId") projectId: string,
  ): Promise<{ results: ProductObjectDto[] }> {
    return { results: await this.productObjectService.getHistory(projectId) };
  }
}

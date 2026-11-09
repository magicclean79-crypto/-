import { Controller, Get, Param, Post, StreamableFile } from "@nestjs/common";
import { PublicInDev } from "../auth/write-protection.guard";
import { Level1GenerateService, type Level1GenerationDto } from "./level1-generate.service";

/**
 * LEVEL 1 원샷 상세페이지 생성 (T1-189).
 *
 * `apps/api/src/level1/level1.controller.ts`(T1-188, 동시 진행 중)와
 * 같은 "level1" 경로 아래 새 하위 경로만 추가한다 — 그 컨트롤러 파일
 * 자체는 수정하지 않는다(다른 모듈, 겹치지 않는 라우트).
 */
@Controller("level1")
export class Level1GenerateController {
  constructor(private readonly service: Level1GenerateService) {}

  @Post("products/:id/generate")
  @PublicInDev()
  generate(@Param("id") productId: string): Promise<Level1GenerationDto> {
    return this.service.generate(productId);
  }

  @Get("products/:id/generations")
  listGenerations(@Param("id") productId: string): Promise<Level1GenerationDto[]> {
    return this.service.listGenerations(productId);
  }

  @Get("generations/:id/file")
  async getGenerationFile(@Param("id") id: string): Promise<StreamableFile> {
    const { buffer, mimeType } = await this.service.getGenerationFile(id);
    return new StreamableFile(buffer, { type: mimeType });
  }
}

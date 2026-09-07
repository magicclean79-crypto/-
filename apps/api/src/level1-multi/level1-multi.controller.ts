import { Controller, Get, Param, Post, StreamableFile } from "@nestjs/common";
import { PublicInDev } from "../auth/write-protection.guard";
import { Level1MultiService, type Level1MultiGenerationDto } from "./level1-multi.service";

/**
 * LEVEL 2 다중 상세페이지 이미지 분할 생성 (T1-191).
 *
 * `apps/api/src/level1/level1.controller.ts`(T1-188)·
 * `apps/api/src/level1-generate/level1-generate.controller.ts`(T1-189)와
 * 같은 "level1" 경로 아래 새 하위 경로만 추가한다 — 그 두 컨트롤러
 * 파일 자체는 수정하지 않는다.
 */
@Controller("level1")
export class Level1MultiController {
  constructor(private readonly service: Level1MultiService) {}

  @Post("products/:id/multi-generate")
  @PublicInDev()
  startGeneration(@Param("id") productId: string): Promise<Level1MultiGenerationDto> {
    return this.service.startGeneration(productId);
  }

  @Get("multi-generations/:id")
  getGeneration(@Param("id") id: string): Promise<Level1MultiGenerationDto> {
    return this.service.getGeneration(id);
  }

  @Get("multi-generations/pages/:pageId/file")
  async getPageFile(@Param("pageId") pageId: string): Promise<StreamableFile> {
    const { buffer, mimeType } = await this.service.getPageFile(pageId);
    return new StreamableFile(buffer, { type: mimeType });
  }
}

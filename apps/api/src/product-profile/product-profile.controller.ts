import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query } from "@nestjs/common";
import type { ProductProfileDto, RunProductProfileRequest } from "@acos/shared";
import { ProductProfileService } from "./product-profile.service";

/**
 * Product Detail Engine V1. (TASK-5601, Sprint 35 — CTO 지시 "Sprint 35
 * Phase 1")
 *
 * STEP 1(업로드) `POST /uploads/images`, STEP 2(OCR) `POST
 * /images/:imageId/ocr`는 기존 라우트를 그대로 쓴다. 이 컨트롤러는
 * STEP 3+4(이미지 특징 분석 → Product Profile 통합)만 노출한다.
 */
@Controller("product-profile")
export class ProductProfileController {
  constructor(private readonly service: ProductProfileService) {}

  /** STEP 3+4 실행 — 실 LLM 호출 2건(이미지 분석 + 통합), 과금 발생 */
  @Post()
  async run(
    @Body() body: RunProductProfileRequest,
  ): Promise<ProductProfileDto> {
    if (!Array.isArray(body?.imageIds)) {
      throw new BadRequestException("imageIds는 문자열 배열이어야 합니다.");
    }
    return this.service.run(body.imageIds, body.projectId, body.templateKey);
  }

  /** 실행 결과 조회 */
  @Get(":id")
  async get(@Param("id") id: string): Promise<ProductProfileDto> {
    return this.service.get(id);
  }

  /** STEP 5 결과 — 완전한 HTML 문서(미리보기·다운로드용). 나중에 다시 열어볼 수 있다 */
  @Get(":id/html")
  @Header("Content-Type", "text/html; charset=utf-8")
  async getHtml(@Param("id") id: string): Promise<string> {
    return this.service.getHtmlDocument(id);
  }

  /** 최근 실행 목록 */
  @Get()
  async list(
    @Query("take") take?: string,
  ): Promise<{ results: ProductProfileDto[] }> {
    return { results: await this.service.list(Number(take ?? "20")) };
  }
}

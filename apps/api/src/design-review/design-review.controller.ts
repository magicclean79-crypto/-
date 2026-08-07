import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import type { DesignReviewDto, RunDesignReviewRequest } from "@acos/shared";
import { DesignReviewService } from "./design-review.service";

/**
 * 디자인 리뷰. (Sprint 35 — "시장 디자인 패턴 학습" CTO 지시)
 *
 * 스크린샷(기존 업로드 이미지 id 재사용)을 Gemini(디자인 디렉터 역할)가
 * 평가한다. Template V1 시안 검토, 시장 조사 스크린샷 분석 등에 쓴다.
 */
@Controller("design-review")
export class DesignReviewController {
  constructor(private readonly service: DesignReviewService) {}

  /** 실 LLM 호출 1건, 과금 발생 — Gemini 키 확보 전에는 기본 Provider로 라우팅된다 */
  @Post()
  async run(@Body() body: RunDesignReviewRequest): Promise<DesignReviewDto> {
    if (!Array.isArray(body?.imageIds)) {
      throw new BadRequestException("imageIds는 문자열 배열이어야 합니다.");
    }
    return this.service.review(body.imageIds, body.category, body.notes, body.provider);
  }

  /** 실행 결과 조회 */
  @Get(":id")
  async get(@Param("id") id: string): Promise<DesignReviewDto> {
    return this.service.get(id);
  }

  /** 최근 실행 목록 */
  @Get()
  async list(@Query("take") take?: string): Promise<{ results: DesignReviewDto[] }> {
    return { results: await this.service.list(Number(take ?? "20")) };
  }
}

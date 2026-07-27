import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import type { AnalysisResultDto, RunAnalysisRequest } from "@acos/shared";
import { AnalysisService } from "./analysis.service";

@Controller("products/:productId/analysis")
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  /** AI 분석 실행 — 실행할 때마다 새 결과가 이력으로 쌓인다 (1:N) */
  @Post()
  async runAnalysis(
    @Param("productId") productId: string,
    @Body() body?: RunAnalysisRequest,
  ): Promise<AnalysisResultDto> {
    return this.analysisService.runAnalysis(productId, body?.apply === true);
  }

  /** 최신 분석 결과 조회 (?raw=true 로 원본 JSON 포함) */
  @Get()
  async getLatest(
    @Param("productId") productId: string,
    @Query("raw") raw?: string,
  ): Promise<AnalysisResultDto> {
    return this.analysisService.getLatestByProductId(productId, raw === "true");
  }

  /** 분석 실행 이력 조회 (최신순) */
  @Get("history")
  async getHistory(
    @Param("productId") productId: string,
  ): Promise<{ results: AnalysisResultDto[] }> {
    return {
      results: await this.analysisService.getHistoryByProductId(productId),
    };
  }
}

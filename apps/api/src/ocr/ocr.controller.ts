import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import type { OcrResultDto } from "@acos/shared";
import { OcrService } from "./ocr.service";

@Controller()
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  /** OCR 실행 — 실행할 때마다 새 결과가 이력으로 쌓인다 (1:N) */
  @Post("images/:imageId/ocr")
  async runOcr(@Param("imageId") imageId: string): Promise<OcrResultDto> {
    return this.ocrService.runOcr(imageId);
  }

  /** 최신 OCR 결과 조회 (?raw=true 로 원본 JSON 포함) */
  @Get("images/:imageId/ocr")
  async getOcr(
    @Param("imageId") imageId: string,
    @Query("raw") raw?: string,
  ): Promise<OcrResultDto> {
    return this.ocrService.getLatestByImageId(imageId, raw === "true");
  }

  /** OCR 실행 이력 조회 (최신순) */
  @Get("images/:imageId/ocr/history")
  async getOcrHistory(
    @Param("imageId") imageId: string,
  ): Promise<{ results: OcrResultDto[] }> {
    return { results: await this.ocrService.getHistoryByImageId(imageId) };
  }

  /** OCR 결과 목록 (원본 JSON 제외) */
  @Get("ocr/results")
  async listResults(
    @Query("take") take?: string,
  ): Promise<{ results: OcrResultDto[] }> {
    return { results: await this.ocrService.list(Number(take ?? "20")) };
  }
}

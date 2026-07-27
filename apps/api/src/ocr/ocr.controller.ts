import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import type { OcrResultDto } from "@acos/shared";
import { OcrService } from "./ocr.service";

@Controller()
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  /** OCR 실행 (기존 결과가 있으면 초기화 후 재실행) */
  @Post("images/:imageId/ocr")
  async runOcr(@Param("imageId") imageId: string): Promise<OcrResultDto> {
    return this.ocrService.runOcr(imageId);
  }

  /** OCR 결과 조회 (?raw=true 로 원본 JSON 포함) */
  @Get("images/:imageId/ocr")
  async getOcr(
    @Param("imageId") imageId: string,
    @Query("raw") raw?: string,
  ): Promise<OcrResultDto> {
    return this.ocrService.getByImageId(imageId, raw === "true");
  }

  /** OCR 결과 목록 (원본 JSON 제외) */
  @Get("ocr/results")
  async listResults(
    @Query("take") take?: string,
  ): Promise<{ results: OcrResultDto[] }> {
    return { results: await this.ocrService.list(Number(take ?? "20")) };
  }
}

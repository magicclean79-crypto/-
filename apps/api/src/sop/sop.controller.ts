import { Controller, Get, Param, Post } from "@nestjs/common";
import type { SopRunDto } from "@acos/shared";
import { SopService } from "./sop.service";

@Controller("projects/:projectId/sop-runs")
export class SopController {
  constructor(private readonly sopService: SopService) {}

  /** 기본 SOP(product-content) 실행 — OCR → 조립 → READY 검수 → 상세페이지 */
  @Post()
  async run(@Param("projectId") projectId: string): Promise<SopRunDto> {
    return this.sopService.run(projectId);
  }

  @Get()
  async list(
    @Param("projectId") projectId: string,
  ): Promise<{ sopRuns: SopRunDto[] }> {
    return { sopRuns: await this.sopService.list(projectId) };
  }

  @Get(":runId")
  async getById(
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ): Promise<SopRunDto> {
    return this.sopService.getById(projectId, runId);
  }
}

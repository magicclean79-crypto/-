import { Controller, Get, Query } from "@nestjs/common";
import type { ExecutionDto } from "@acos/shared";
import { ExecutionService } from "./execution.service";

@Controller("executions")
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  /** LLM 호출 이력 조회 (최신순) — ?feature=&limit= */
  @Get()
  async list(
    @Query("feature") feature?: string,
    @Query("limit") limit?: string,
  ): Promise<{ executions: ExecutionDto[] }> {
    return {
      executions: await this.executionService.list({
        feature: feature || undefined,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    };
  }
}

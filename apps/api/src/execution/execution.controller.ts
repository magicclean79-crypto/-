import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import type { ExecutionDashboardDto, ExecutionDto } from "@acos/shared";
import { ExecutionService } from "./execution.service";

/** ISO 날짜/일시 파싱 — 잘못된 값은 400 */
function parseDate(name: string, value?: string): Date | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      `${name}은(는) 유효한 ISO 날짜여야 합니다: ${value}`,
    );
  }
  return parsed;
}

@Controller("executions")
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  /** Execution Dashboard (TASK-0602) — ?from=&to= (ISO, 미지정 시 전체 기간) */
  @Get("stats")
  async stats(
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<ExecutionDashboardDto> {
    return this.executionService.dashboard({
      from: parseDate("from", from),
      to: parseDate("to", to),
    });
  }

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

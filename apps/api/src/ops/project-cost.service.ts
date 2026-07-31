import { Injectable, Logger } from "@nestjs/common";
import { detectAttributionAlerts, summarizeProjectCost } from "@acos/core";
import type { CostRecord, DetectedAlert } from "@acos/core";
import type { ProjectCostDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

/** 집계 창 — 지표는 창을 밝히지 않으면 아무 뜻이 없다 */
export const PROJECT_COST_WINDOW_DAYS = 30;

/**
 * 귀속률이 이보다 낮으면 표를 믿을 수 없다고 알린다.
 *
 * 100%를 요구하지 않는 이유: 옛 기록은 전부 미배분이고, 그것은 우리가
 * 고칠 수 없습니다. 새 호출이 대부분 붙기 시작하면 이 값을 넘습니다.
 */
export const MIN_ATTRIBUTION_COVERAGE = 80;

/**
 * 프로젝트별 운영 비용. (TASK-4201, Sprint 42 — CTO 정책 4201-④)
 *
 * "어느 프로젝트가 돈을 쓰는가"는 네 스프린트째 답할 수 없던 질문입니다.
 * 이번에 `projectId`를 붙였고, **옛 기록은 전부 null**입니다.
 *
 * 판정은 전부 `@acos/core`가 합니다 — 특히 **미배분을 프로젝트에 나눠 얹지
 * 않는다**는 규칙이 거기 있습니다.
 */
@Injectable()
export class ProjectCostService {
  private readonly logger = new Logger(ProjectCostService.name);

  constructor(private readonly prisma: PrismaService) {}

  async report(
    windowDays = PROJECT_COST_WINDOW_DAYS,
    now = Date.now(),
  ): Promise<ProjectCostDto> {
    const since = new Date(now - windowDays * 24 * 60 * 60 * 1000);

    const [executions, ocr, projects] = await Promise.all([
      this.prisma.execution.findMany({
        where: { createdAt: { gte: since } },
        select: { projectId: true, cost: true, diagnostic: true },
      }),
      this.prisma.ocrResult.findMany({
        where: { createdAt: { gte: since } },
        select: { projectId: true, cost: true },
      }),
      this.prisma.project.findMany({ select: { id: true, name: true } }),
    ]);

    const records: CostRecord[] = [
      ...executions.map(
        (row): CostRecord => ({
          projectId: row.projectId,
          source: "llm",
          cost: row.cost === null ? null : Number(row.cost),
          diagnostic: row.diagnostic,
        }),
      ),
      ...ocr.map(
        (row): CostRecord => ({
          projectId: row.projectId,
          source: "ocr",
          cost: row.cost === null ? null : Number(row.cost),
          // OCR에는 진단 표시가 없다 — 스모크가 남기는 것도 여기 섞이지만,
          // 없는 칸을 있는 척하지 않는다
          diagnostic: false,
        }),
      ),
    ];

    const names = Object.fromEntries(projects.map((row) => [row.id, row.name]));
    const report = summarizeProjectCost({ records, names, windowDays });

    if (report.coverage !== null && report.coverage < MIN_ATTRIBUTION_COVERAGE) {
      this.logger.log(`프로젝트 비용 귀속률 ${report.coverage}% — ${report.caveat}`);
    }

    return { ...report, checkedAt: new Date(now).toISOString() };
  }

  /** 귀속률이 낮은 것을 경보로 — 보내는 것은 AlertService가 한다 */
  async detect(alerting: boolean, now = Date.now()): Promise<DetectedAlert[]> {
    const report = await this.report(PROJECT_COST_WINDOW_DAYS, now);
    return detectAttributionAlerts(
      { ...report, caveat: report.caveat },
      { alerting, minCoverage: MIN_ATTRIBUTION_COVERAGE },
    ) as DetectedAlert[];
  }
}

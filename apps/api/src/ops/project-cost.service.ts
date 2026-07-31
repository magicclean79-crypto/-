import { Injectable, Logger } from "@nestjs/common";
import {
  ATTRIBUTION_MIN_SAMPLE,
  analyzeAttributionGap,
  detectAttributionAlerts,
  isAttributableFeature,
  summarizeProjectCost,
} from "@acos/core";
import type { AttributionRecord, CostRecord, DetectedAlert } from "@acos/core";
import type { AttributionGapDto, ProjectCostDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

/** 집계 창 — 지표는 창을 밝히지 않으면 아무 뜻이 없다 */
export const PROJECT_COST_WINDOW_DAYS = 30;

/**
 * 귀속률이 이보다 낮으면 표를 믿을 수 없다고 알린다.
 *
 * 100%를 요구하지 않는 이유: 옛 기록은 전부 미배분이고, 그것은 우리가
 * 고칠 수 없습니다. 새 호출이 대부분 붙기 시작하면 이 값을 넘습니다.
 */
export const MIN_ATTRIBUTION_COVERAGE = 95;

/** 미귀속 경로를 보는 창 (TASK-4401, 정책 4401-②) */
export const ATTRIBUTION_GAP_WINDOW_HOURS = 24;

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
        select: {
          projectId: true,
          cost: true,
          diagnostic: true,
          feature: true,
          createdAt: true,
        },
      }),
      this.prisma.ocrResult.findMany({
        where: { createdAt: { gte: since } },
        select: { projectId: true, cost: true, createdAt: true },
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
          // 개발용 호출은 프로젝트가 있을 수 없다 (TASK-4301, 정책 ②) —
          // 그것을 "귀속 누락"으로 세면 귀속률이 100%에 닿지 않는다
          feature: row.feature,
          at: row.createdAt.getTime(),
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
          // 기능 구분이 없다 — null은 "귀속 대상"으로 본다 (모르는 것을
          // "주인이 없는 것"으로 옮기면 귀속률이 저절로 좋아진다)
          feature: null,
          at: row.createdAt.getTime(),
        }),
      ),
    ];

    const names = Object.fromEntries(projects.map((row) => [row.id, row.name]));
    const report = summarizeProjectCost({ records, names, windowDays, now });

    if (report.coverage !== null && report.coverage < MIN_ATTRIBUTION_COVERAGE) {
      this.logger.log(`프로젝트 비용 귀속률 ${report.coverage}% — ${report.caveat}`);
    }

    return { ...report, checkedAt: new Date(now).toISOString() };
  }

  /**
   * 미귀속 실행 경로 분석 (TASK-4401, CTO 정책 4401-②).
   *
   * 귀속률만 보면 "덜 됐다"까지만 알 수 있습니다. **어느 경로가 빠뜨리는지**
   * 를 말해야 다음에 무엇을 고칠지 정할 수 있습니다.
   *
   * 무엇이 귀속 대상인지는 여기서 다시 정하지 않습니다 — `@acos/core`의
   * `isAttributableFeature`가 정합니다(두 곳에서 정하면 어긋나는 날이 옵니다).
   */
  async gap(
    windowHours = ATTRIBUTION_GAP_WINDOW_HOURS,
    now = Date.now(),
  ): Promise<AttributionGapDto> {
    const since = new Date(now - windowHours * 3_600_000);

    const [executions, ocr] = await Promise.all([
      this.prisma.execution.findMany({
        where: { createdAt: { gte: since }, diagnostic: false },
        select: { projectId: true, feature: true },
      }),
      this.prisma.ocrResult.findMany({
        where: { createdAt: { gte: since } },
        select: { projectId: true },
      }),
    ]);

    const records: AttributionRecord[] = [
      ...executions
        // 개발용 호출은 프로젝트가 있을 수 없다 — 분모에서 뺀다 (정책 4301-②)
        .filter((row) => isAttributableFeature(row.feature))
        .map(
          (row): AttributionRecord => ({
            feature: row.feature,
            source: "llm",
            attributed: row.projectId !== null,
          }),
        ),
      ...ocr.map(
        (row): AttributionRecord => ({
          feature: null,
          source: "ocr",
          attributed: row.projectId !== null,
        }),
      ),
    ];

    const report = analyzeAttributionGap({
      records,
      target: MIN_ATTRIBUTION_COVERAGE,
    });

    if (report.verdict === "below") {
      this.logger.log(`미귀속 경로: ${report.detail}`);
    }

    return {
      rows: report.rows,
      total: report.total,
      attributed: report.attributed,
      missing: report.missing,
      coverage: report.coverage,
      target: report.target,
      minSample: report.minSample,
      verdict: report.verdict,
      windowHours,
      detail: report.detail,
      next: report.next,
      checkedAt: new Date(now).toISOString(),
    };
  }

  /** 귀속률이 낮은 것을 경보로 — 보내는 것은 AlertService가 한다 */
  async detect(alerting: boolean, now = Date.now()): Promise<DetectedAlert[]> {
    const report = await this.report(PROJECT_COST_WINDOW_DAYS, now);
    return detectAttributionAlerts(
      { ...report, caveat: report.caveat },
      {
        alerting,
        minCoverage: MIN_ATTRIBUTION_COVERAGE,
        // 화면이 "표본 부족 — 판정 보류"라고 말하는 상태에서 경보가 "목표
        // 미달"이라고 사람을 깨우면, 같은 사실에 두 개의 답이 생긴다
        // (라이브 검증에서 고침)
        minSample: ATTRIBUTION_MIN_SAMPLE,
      },
    ) as DetectedAlert[];
  }
}

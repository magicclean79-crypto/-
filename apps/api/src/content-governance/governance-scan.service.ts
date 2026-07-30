import { Injectable, Logger } from "@nestjs/common";
import {
  compareScan,
  describeScanRun,
  detectGovernanceScanAlert,
  shouldSyncScanAlerts,
} from "@acos/core";
import type { ScanTotals } from "@acos/core";
import type {
  GovernanceScanRunDto,
  PreflightSummaryDto,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { GovernancePreflightService } from "./governance-preflight.service";

/** 전체 범위의 비교 기준 키 */
export const ALL_SCOPE = "all";

/** 프로젝트 범위의 비교 기준 키 */
export function projectScope(projectId: string): string {
  return `project:${projectId}`;
}

export interface ScanOutcome {
  run: GovernanceScanRunDto;
  /** 이 실행이 만든 경보 (없으면 빈 배열) */
  alerts: { key: string; level: string; title: string }[];
}

/**
 * Scheduled Governance Scan. (TASK-2701, Sprint 27 — CTO 결정 2601-②③)
 *
 * 예약으로 위반을 훑고, **늘었을 때만** 경보한다.
 *
 * 스캔 자체는 `GovernancePreflightService`가 하고(**쓰기 없음**), 이 계층은
 * 그 결과를 **기록하고 비교한다.** 기록하는 이유는 둘이다:
 *
 * - 지난 결과가 없으면 "늘었는가"를 판정할 수 없다 (결정 2601-③).
 * - **경보를 만들지 않은 실행도 남긴다** — "돌았지만 조용했다"와 "돌지
 *   않았다"는 다르고, 그 구분이 없으면 예약이 멈춘 것을 알아챌 수 없다.
 */
@Injectable()
export class GovernanceScanService {
  private readonly logger = new Logger(GovernanceScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preflight: GovernancePreflightService,
  ) {}

  /**
   * 한 범위를 스캔하고 결과를 기록한다.
   *
   * 경보 동기화는 여기서 하지 않는다 — 경보 종류별 해소 범위를 다루는 것은
   * `ScheduledChecksService`의 책임이고(결정 1302-③), 이 계층이 직접 부르면
   * 같은 종류를 두 곳에서 동기화하게 된다. 대신 **감지 결과를 돌려준다.**
   */
  async run(options: {
    projectId?: string;
    trigger: string;
  }): Promise<{
    outcome: ScanOutcome;
    detected: ReturnType<typeof detectGovernanceScanAlert>;
    /** 경보 저장소를 건드릴 때인가 (CTO 결정 2601-③) */
    shouldSync: boolean;
  }> {
    const scope =
      options.projectId === undefined
        ? ALL_SCOPE
        : projectScope(options.projectId);

    // 이미 나간 위반까지 본다 — 예약 스캔은 "지금 이 시스템의 위반 총량"을
    // 재는 것이고, 막을 수 없는 것을 빼면 총량이 아니다
    const scan = await this.preflight.scan({
      projectId: options.projectId,
      statuses: ["DRAFT", "REVIEW", "PUBLISHED"],
      // 목록은 필요 없다 — 경보 판정은 총계로 한다
      limit: 1,
    });

    const current: ScanTotals = {
      blocked: scan.summary.blocked,
      publishedViolations: scan.summary.publishedViolations,
      scanned: scan.summary.scanned,
    };
    const previous = await this.previousTotals(scope);
    const change = compareScan(previous, current);
    const detected = detectGovernanceScanAlert(change, current, { scope });
    const detail = describeScanRun(change, current);

    const row = await this.prisma.governanceScanRun.create({
      data: {
        scope,
        scanned: scan.summary.scanned,
        blocked: scan.summary.blocked,
        publishedViolations: scan.summary.publishedViolations,
        warned: scan.summary.warned,
        clean: scan.summary.clean,
        byCheck: scan.summary.byCheck as unknown as object,
        verdict: change.verdict,
        previousTotal: change.previous,
        total: change.current,
        // 경보를 만들었는지 그대로 남긴다 — 나중에 "왜 안 왔지"에 답해야 한다
        alerted: detected.length > 0,
        trigger: options.trigger,
      },
    });

    if (change.verdict === "increased") {
      this.logger.warn(detail);
    } else {
      this.logger.log(detail);
    }

    return {
      outcome: {
        run: this.toDto(row, detail),
        alerts: detected.map((alert) => ({
          key: alert.key,
          level: alert.level,
          title: alert.title,
        })),
      },
      detected,
      shouldSync: shouldSyncScanAlerts(change),
    };
  }

  /** 실행 이력 — 최신순. 범위별로 나눠 본다 */
  async history(
    options: { scope?: string; limit?: number } = {},
  ): Promise<GovernanceScanRunDto[]> {
    const rows = await this.prisma.governanceScanRun.findMany({
      where: options.scope ? { scope: options.scope } : {},
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 20,
    });
    return rows.map((row) =>
      this.toDto(
        row,
        describeScanRun(
          {
            verdict: row.verdict as ReturnType<typeof compareScan>["verdict"],
            previous: row.previousTotal,
            current: row.total,
            delta:
              row.previousTotal === null
                ? 0
                : Math.max(0, row.total - row.previousTotal),
          },
          {
            blocked: row.blocked,
            publishedViolations: row.publishedViolations,
            scanned: row.scanned,
          },
        ),
      ),
    );
  }

  /**
   * 직전 실행의 총계 — 없으면 `null`(첫 스캔).
   *
   * **경보를 만들지 않은 실행도 기준이 된다.** 경보를 낸 실행만 기준으로
   * 삼으면, 늘었다가 줄어든 뒤 다시 늘 때 "늘었다"를 놓친다.
   */
  private async previousTotals(scope: string): Promise<ScanTotals | null> {
    const row = await this.prisma.governanceScanRun.findFirst({
      where: { scope },
      orderBy: { createdAt: "desc" },
    });
    if (!row) {
      return null;
    }
    return {
      blocked: row.blocked,
      publishedViolations: row.publishedViolations,
      scanned: row.scanned,
    };
  }

  private toDto(
    row: {
      id: string;
      scope: string;
      scanned: number;
      blocked: number;
      publishedViolations: number;
      warned: number;
      clean: number;
      byCheck: unknown;
      verdict: string;
      previousTotal: number | null;
      total: number;
      alerted: boolean;
      trigger: string;
      createdAt: Date;
    },
    detail: string,
  ): GovernanceScanRunDto {
    return {
      id: row.id,
      scope: row.scope,
      summary: {
        scanned: row.scanned,
        blocked: row.blocked,
        publishedViolations: row.publishedViolations,
        warned: row.warned,
        clean: row.clean,
        byCheck: (row.byCheck ?? []) as PreflightSummaryDto["byCheck"],
      },
      verdict: row.verdict as GovernanceScanRunDto["verdict"],
      previousTotal: row.previousTotal,
      total: row.total,
      alerted: row.alerted,
      trigger: row.trigger,
      detail,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

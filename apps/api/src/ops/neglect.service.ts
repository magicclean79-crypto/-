import { Injectable, Logger } from "@nestjs/common";
import { detectNeglectAlerts, judgeNeglect } from "@acos/core";
import type { DetectedAlert, DeploymentTier, NeglectRun } from "@acos/core";
import type { NeglectReportDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

/** 이 기간을 넘게 나쁘면 "대응 중"이 아니라 "방치"로 본다 */
export const NEGLECT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** 방치를 보는 창 — 진단 이력 보존(기본 90일)보다 길게 볼 수는 없다 */
export const NEGLECT_WINDOW_DAYS = 90;

/**
 * 연속 실패 기간과 방치 지표. (TASK-4201, Sprint 42 — CTO 정책 4201-②)
 *
 * TASK-4101의 비교는 직전 1회와만 했고, 그래서 "3주째 같은 실패"가
 * `persisting`이라는 한 단어로만 보였습니다. 어제 시작된 실패와 석 달 된
 * 실패를 **똑같이** 보이게 하는 표현입니다.
 *
 * 판정은 전부 `@acos/core`가 합니다.
 */
@Injectable()
export class NeglectService {
  private readonly logger = new Logger(NeglectService.name);

  constructor(private readonly prisma: PrismaService) {}

  async report(
    tier: DeploymentTier,
    stage = "daily",
    now = Date.now(),
  ): Promise<NeglectReportDto> {
    const since = new Date(now - NEGLECT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // **같은 단계·같은 배포 단계끼리만** 본다 (정책 4101-②와 같은 이유):
    // 기동 진단과 일일 진단은 항목 구성이 다르므로 섞으면 연속이 끊긴다
    const rows = await this.prisma.diagnosticRun
      .findMany({
        where: { tier, stage, ranAt: { gte: since } },
        orderBy: { ranAt: "asc" },
      })
      .catch((error: unknown) => {
        this.logger.warn(`진단 이력을 읽지 못했습니다: ${String(error)}`);
        return [];
      });

    const runs: NeglectRun[] = rows.map((row) => ({
      ranAt: row.ranAt.getTime(),
      checks: row.checks as NeglectRun["checks"],
    }));

    const report = judgeNeglect({ runs, now, neglectAfterMs: NEGLECT_AFTER_MS });

    return {
      streaks: report.streaks.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        runs: row.runs,
        since: new Date(row.since).toISOString(),
        durationDays: Math.floor(row.durationMs / 86_400_000),
        durationLabel: row.durationLabel,
        truncated: row.truncated,
        detail: row.detail,
      })),
      worst:
        report.worst === null
          ? null
          : {
              id: report.worst.id,
              title: report.worst.title,
              status: report.worst.status,
              runs: report.worst.runs,
              since: new Date(report.worst.since).toISOString(),
              durationDays: Math.floor(report.worst.durationMs / 86_400_000),
              durationLabel: report.worst.durationLabel,
              truncated: report.worst.truncated,
              detail: report.worst.detail,
            },
      runs: report.runs,
      largestGapDays:
        report.largestGapMs === null
          ? null
          : Math.floor(report.largestGapMs / 86_400_000),
      neglectAfterDays: Math.round(NEGLECT_AFTER_MS / 86_400_000),
      detail: report.detail,
    };
  }

  /** 방치 경보 — 보내는 것은 AlertService가 한다 */
  async detect(
    tier: DeploymentTier,
    alerting: boolean,
    now = Date.now(),
  ): Promise<DetectedAlert[]> {
    const since = new Date(now - NEGLECT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.diagnosticRun
      .findMany({
        where: { tier, stage: "daily", ranAt: { gte: since } },
        orderBy: { ranAt: "asc" },
      })
      .catch(() => []);

    const report = judgeNeglect({
      runs: rows.map((row) => ({
        ranAt: row.ranAt.getTime(),
        checks: row.checks as NeglectRun["checks"],
      })),
      now,
      neglectAfterMs: NEGLECT_AFTER_MS,
    });

    return detectNeglectAlerts(report, {
      tier,
      alerting,
      neglectAfterMs: NEGLECT_AFTER_MS,
    }) as DetectedAlert[];
  }
}

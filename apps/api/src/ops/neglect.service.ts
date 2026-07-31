import { Injectable, Logger } from "@nestjs/common";
import {
  MAX_IGNORE_DAYS,
  applyIgnores,
  detectIgnoreAwareAlerts,
  judgeIgnoreRequest,
  judgeNeglect,
} from "@acos/core";
import type {
  DetectedAlert,
  DeploymentTier,
  IgnoredNeglectReport,
  NeglectIgnore,
  NeglectRun,
} from "@acos/core";
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

    const report = await this.decorate(
      judgeNeglect({ runs, now, neglectAfterMs: NEGLECT_AFTER_MS }),
      tier,
      now,
    );

    return {
      ignoredCount: report.ignoredCount,
      overdueCount: report.overdueCount,
      maxIgnoreDays: MAX_IGNORE_DAYS,
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
        ignored: row.ignored,
        ignoreId: row.ignoreId,
        ignoreOwner: row.ignoreOwner,
        ignoreReason: row.ignoreReason,
        ignoreReviewAt:
          row.ignoreReviewAt === null ? null : new Date(row.ignoreReviewAt).toISOString(),
        reviewOverdue: row.reviewOverdue,
        ignoreLabel: row.ignoreLabel,
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
              ignored: report.worst.ignored,
              ignoreId: report.worst.ignoreId,
              ignoreOwner: report.worst.ignoreOwner,
              ignoreReason: report.worst.ignoreReason,
              ignoreReviewAt:
                report.worst.ignoreReviewAt === null
                  ? null
                  : new Date(report.worst.ignoreReviewAt).toISOString(),
              reviewOverdue: report.worst.reviewOverdue,
              ignoreLabel: report.worst.ignoreLabel,
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

    const report = await this.decorate(
      judgeNeglect({
        runs: rows.map((row) => ({
          ranAt: row.ranAt.getTime(),
          checks: row.checks as NeglectRun["checks"],
        })),
        now,
        neglectAfterMs: NEGLECT_AFTER_MS,
      }),
      tier,
      now,
    );

    return detectIgnoreAwareAlerts(report, {
      tier,
      alerting,
      neglectAfterMs: NEGLECT_AFTER_MS,
    }) as DetectedAlert[];
  }

  /**
   * 살아 있는 무시 결정 (CTO 정책 4301-③).
   *
   * 취소된 것(`revokedAt`)은 빼지만 **행을 지우지는 않습니다** — 지우면
   * 무시했던 사실까지 사라집니다.
   */
  private async ignores(tier: DeploymentTier): Promise<NeglectIgnore[]> {
    const rows = await this.prisma.neglectDecision
      .findMany({ where: { tier, revokedAt: null }, orderBy: { decidedAt: "desc" } })
      .catch((error: unknown) => {
        this.logger.warn(`무시 결정을 읽지 못했습니다: ${String(error)}`);
        return [];
      });
    return rows.map((row) => ({
      id: row.id,
      checkId: row.checkId,
      tier: row.tier,
      reason: row.reason,
      owner: row.owner,
      reviewAt: row.reviewAt.getTime(),
      decidedAt: row.decidedAt.getTime(),
      decidedBy: row.decidedById ?? "unknown",
    }));
  }

  private async decorate(
    report: ReturnType<typeof judgeNeglect>,
    tier: DeploymentTier,
    now: number,
  ): Promise<IgnoredNeglectReport> {
    return applyIgnores(report, await this.ignores(tier), { tier, now });
  }

  /**
   * 무시를 만든다 — 판정은 `@acos/core`가 합니다.
   *
   * 검토일이 지나면 판정이 자동으로 풀므로 여기서 만료를 지우지 않습니다.
   * 지난 결정을 다시 쓰지 않는다는 원칙(TASK-4101 정책 ④)과 같습니다.
   */
  async ignore(input: {
    checkId: string;
    tier: DeploymentTier;
    title?: string;
    reason: string;
    owner: string;
    reviewAt: number;
    decidedById: string | null;
    now?: number;
  }): Promise<{ ok: boolean; reason: string; id: string | null }> {
    const now = input.now ?? Date.now();
    const verdict = judgeIgnoreRequest({
      reason: input.reason,
      owner: input.owner,
      reviewAt: input.reviewAt,
      now,
      title: input.title,
    });
    if (!verdict.ok) {
      return { ...verdict, id: null };
    }
    // 같은 항목에 살아 있는 무시가 있으면 그것을 취소하고 새로 만든다 —
    // 덮어쓰면 "언제부터 무시했는가"가 사라진다
    await this.prisma.neglectDecision.updateMany({
      where: { tier: input.tier, checkId: input.checkId, revokedAt: null },
      data: { revokedAt: new Date(now), revokedById: input.decidedById },
    });
    const created = await this.prisma.neglectDecision.create({
      data: {
        checkId: input.checkId,
        tier: input.tier,
        reason: input.reason.trim(),
        owner: input.owner.trim(),
        reviewAt: new Date(input.reviewAt),
        decidedAt: new Date(now),
        decidedById: input.decidedById,
      },
    });
    return { ...verdict, id: created.id };
  }

  /** 무시를 취소한다 — 행은 남고 취소 기록이 붙는다 */
  async revoke(
    id: string,
    revokedById: string | null,
    now = Date.now(),
  ): Promise<boolean> {
    const updated = await this.prisma.neglectDecision.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(now), revokedById },
    });
    return updated.count > 0;
  }

  /** 무시 이력 — 취소된 것도 보인다 */
  async decisions(tier: DeploymentTier, now = Date.now()) {
    const rows = await this.prisma.neglectDecision
      .findMany({ where: { tier }, orderBy: { decidedAt: "desc" }, take: 50 })
      .catch(() => []);
    return rows.map((row) => ({
      id: row.id,
      checkId: row.checkId,
      tier: row.tier,
      reason: row.reason,
      owner: row.owner,
      reviewAt: row.reviewAt.toISOString(),
      decidedAt: row.decidedAt.toISOString(),
      decidedById: row.decidedById,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      // 검토일이 지난 것은 무시가 아니다 — 목록에서도 그렇게 보여야 한다
      active: row.revokedAt === null && row.reviewAt.getTime() > now,
      reviewOverdue: row.revokedAt === null && row.reviewAt.getTime() <= now,
    }));
  }
}

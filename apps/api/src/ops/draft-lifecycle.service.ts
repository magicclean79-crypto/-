import { Injectable, Logger } from "@nestjs/common";
import {
  detectStaleDraftAlerts,
  judgeDraftLifecycle,
  resolveDraftLifecycleSettings,
} from "@acos/core";
import type { DetectedAlert, DraftAge } from "@acos/core";
import type { DraftLifecycleDto } from "@acos/shared";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 장애 초안 수명. (TASK-4001, Sprint 40 — CTO 정책 4001-①)
 *
 * TASK-3901이 만든 초안은 사람이 확인하거나 기각해야 끝납니다. 아무도
 * 대답하지 않으면 목록이 대답 없는 질문으로 뒤덮이고, 그때부터 초안은
 * 있으나 마나입니다.
 *
 * **자동으로 기각하지 않습니다** — 기각은 "아무것도 아니었다"는 판단이고,
 * 아무도 보지 않은 것을 시스템이 그렇게 판단하면 진짜 장애가 조용히
 * 사라집니다. 대신 오래된 것은 경보로 부르고, 아주 오래된 것은 **만료**로
 * 표시합니다. 만료는 기각이 아니라 "아무도 판단하지 않았다"는 기록입니다.
 *
 * 판정은 전부 `@acos/core`가 합니다.
 */
@Injectable()
export class DraftLifecycleService {
  private readonly logger = new Logger(DraftLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AdminSettingsService,
  ) {}

  /** 지금 상태를 판정한다 — 아무것도 바꾸지 않는다 */
  async report(now = Date.now()): Promise<DraftLifecycleDto> {
    const { staleAfterMs, expireAfterMs, rejected } = this.resolve();
    const drafts = await this.openDrafts();
    const judged = judgeDraftLifecycle({ drafts, now, staleAfterMs, expireAfterMs });

    const expiredRows = await this.prisma.incident.findMany({
      where: { status: "DRAFT", expiredAt: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return {
      stale: judged.stale.map((row) => ({
        id: row.id,
        summary: row.summary,
        createdAt: new Date(row.createdAt).toISOString(),
        ageDays: Math.floor((now - row.createdAt) / 86_400_000),
      })),
      // **아직 표시되지 않은 것**과 **이미 표시된 것**을 나눈다 — 한 칸에
      // 넣으면 요약이 "만료 1건"이라 말하는데 목록은 비어 있게 된다
      expiring: judged.expiring.map((row) => ({
        id: row.id,
        summary: row.summary,
        createdAt: new Date(row.createdAt).toISOString(),
        ageDays: Math.floor((now - row.createdAt) / 86_400_000),
      })),
      expired: expiredRows.map((row) => ({
        id: row.id,
        summary: row.summary,
        createdAt: row.createdAt.toISOString(),
        // 위 where가 null이 아닌 것만 고르지만 타입은 그것을 모른다
        expiredAt: (row.expiredAt ?? row.createdAt).toISOString(),
      })),
      staleAfterDays: Math.round(staleAfterMs / 86_400_000),
      expireAfterDays: Math.round(expireAfterMs / 86_400_000),
      detail:
        judged.detail +
        (rejected.length > 0
          ? ` 받아들이지 않은 설정 ${rejected.length}건: ${rejected
              .map((row) => row.reason)
              .join(" · ")}`
          : ""),
    };
  }

  /**
   * 수명을 넘긴 초안을 만료로 표시하고, 방치된 초안 경보를 돌려준다.
   *
   * 경보를 여기서 **보내지 않고 돌려주는** 이유: 중복·해소 판정은
   * `AlertService`가 한 곳에서 하고 있고, 그 판단을 두 곳에 두면 같은
   * 초안으로 경보가 두 번 납니다.
   */
  async sweep(now = Date.now()): Promise<{ expired: number; alerts: DetectedAlert[]; detail: string }> {
    const { staleAfterMs, expireAfterMs } = this.resolve();
    const drafts = await this.openDrafts();
    const judged = judgeDraftLifecycle({ drafts, now, staleAfterMs, expireAfterMs });

    let expired = 0;
    if (judged.expiring.length > 0) {
      // **status는 DRAFT로 둔다** — 만료는 기각이 아니므로 상태를 바꾸면
      // 나중에 이력을 읽는 사람이 방치를 기각 실적으로 읽는다
      const result = await this.prisma.incident.updateMany({
        where: { id: { in: judged.expiring.map((row) => row.id) } },
        data: { expiredAt: new Date(now) },
      });
      expired = result.count;
      this.logger.warn(
        `장애 초안 ${expired}건을 만료로 표시했습니다 — 기각이 아니라 ` +
          "아무도 판단하지 않았다는 기록입니다.",
      );
    }

    const alerts = detectStaleDraftAlerts(judged) as DetectedAlert[];
    return { expired, alerts, detail: judged.detail };
  }

  /** 아직 판단되지 않은 초안 — 만료된 것은 이미 "아무도 안 봤다"를 인정했다 */
  private async openDrafts(): Promise<DraftAge[]> {
    const rows = await this.prisma.incident.findMany({
      where: { status: "DRAFT", expiredAt: null },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      summary: row.summary,
      createdAt: row.createdAt.getTime(),
      sourceAlertKey: row.sourceAlertKey,
    }));
  }

  private resolve(): ReturnType<typeof resolveDraftLifecycleSettings> {
    const resolved = resolveDraftLifecycleSettings(this.settings.all());
    if (resolved.rejected.length > 0) {
      this.logger.warn(
        `받아들이지 않은 초안 수명 설정: ${resolved.rejected
          .map((row) => `${row.key}(${row.reason})`)
          .join(" · ")}`,
      );
    }
    return resolved;
  }
}

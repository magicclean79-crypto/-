import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  REVIVAL_ACTIONS,
  describeRevival,
  judgeRevival,
  revivalOutcome,
  summarizeRevivals,
} from "@acos/core";
import type { RevivalAction, RevivalRecord } from "@acos/core";
import type { DraftRevivalSummaryDto, IncidentDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { IncidentService } from "./incident.service";

/**
 * 만료 초안 되살리기. (TASK-4101, Sprint 41 — CTO 정책 4101-④)
 *
 * TASK-4001은 30일 넘게 아무도 안 본 초안을 만료로 표시했습니다. 되돌릴
 * 길이 없었는데, 실제로 필요한 경우가 둘 있습니다: 뒤늦게 진짜 장애였음이
 * 드러나는 경우와, 휴가·이관으로 아무도 못 봤을 뿐인 경우입니다.
 *
 * **되살리면서 "안 늦은 것처럼" 만들지 않습니다.** 만료 표시를 지우면
 * 목록은 깨끗해지고 이력은 "확인된 장애 1건"이 되지만, 나중에 이력을 읽는
 * 사람은 "우리 팀은 초안을 잘 처리한다"고 읽습니다 — 실제로는 3주 늦게
 * 본 것인데도.
 *
 * 판정은 전부 `@acos/core`가 합니다.
 */
@Injectable()
export class DraftRevivalService {
  private readonly logger = new Logger(DraftRevivalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly incidents: IncidentService,
  ) {}

  /** 만료된 초안에 뒤늦게 판단을 내린다 */
  async revive(
    id: string,
    input: {
      action: string;
      reason: string;
      summary?: string;
      actorId?: string;
    },
    now = Date.now(),
  ): Promise<IncidentDto> {
    if (!REVIVAL_ACTIONS.includes(input.action as RevivalAction)) {
      throw new BadRequestException(
        `알 수 없는 조치입니다: ${input.action} (${REVIVAL_ACTIONS.join(" · ")})`,
      );
    }
    const action = input.action as RevivalAction;

    const row = await this.prisma.incident.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException("그런 장애 기록이 없습니다.");
    }

    const judged = judgeRevival({
      draft: {
        status: row.status,
        expiredAt: row.expiredAt?.getTime() ?? null,
        createdAt: row.createdAt.getTime(),
      },
      action,
      reason: input.reason ?? "",
      summary: input.summary,
      now,
    });
    if (!judged.ok) {
      throw new BadRequestException(judged.reason);
    }

    const outcome = revivalOutcome(action);
    const latenessMs = judged.latenessMs ?? 0;

    await this.prisma.incident.update({
      where: { id },
      data: {
        status: outcome.status,
        // **만료됐던 사실을 지우지 않는다** — 예외는 만료 취소뿐이고,
        // 그때도 되살린 기록(`revivedAt`)은 남는다
        ...(outcome.clearExpiry ? { expiredAt: null } : {}),
        ...(action === "confirm"
          ? { summary: (input.summary ?? "").trim(), openedById: input.actorId ?? null }
          : {}),
        ...(action === "dismiss"
          ? {
              dismissedAt: new Date(now),
              dismissReason: input.reason.trim(),
              dismissedById: input.actorId ?? null,
            }
          : {}),
        revivedAt: new Date(now),
        revivedById: input.actorId ?? null,
        revivalAction: action,
        revivalReason: input.reason.trim(),
        revivalLatenessMs: latenessMs,
      },
    });

    this.logger.warn(
      `장애 초안 되살림 [${row.component}] ` +
        describeRevival({ action, latenessMs, reason: input.reason.trim() }),
    );
    return this.incidents.get(id);
  }

  /**
   * 되살림 이력 (CTO 정책 4101-④).
   *
   * `confirmed`가 많다는 것은 **만료된 것 중 진짜 장애가 섞여 있었다**는
   * 뜻입니다. 그 해석을 요약이 직접 적습니다 — 그러지 않으면 이 숫자가
   * "잘 처리했다"는 성과로 읽힙니다.
   */
  async history(limit = 50): Promise<DraftRevivalSummaryDto> {
    const rows = await this.prisma.incident.findMany({
      where: { revivedAt: { not: null } },
      orderBy: { revivedAt: "desc" },
      take: limit,
    });

    const records: RevivalRecord[] = rows.map((row) => ({
      action: (row.revivalAction ?? "reopen") as RevivalAction,
      latenessMs: row.revivalLatenessMs ?? 0,
      revivedAt: row.revivedAt?.getTime() ?? 0,
    }));
    const summary = summarizeRevivals(records);

    return {
      revivals: rows.map((row, index) => ({
        id: row.id,
        summary: row.summary,
        action: records[index].action,
        reason: row.revivalReason ?? "",
        latenessDays: Math.floor(records[index].latenessMs / 86_400_000),
        actor: row.revivedById,
        revivedAt: (row.revivedAt ?? row.createdAt).toISOString(),
        detail: describeRevival({
          action: records[index].action,
          latenessMs: records[index].latenessMs,
          reason: row.revivalReason ?? "",
        }),
      })),
      total: summary.total,
      confirmed: summary.confirmed,
      dismissed: summary.dismissed,
      reopened: summary.reopened,
      averageLatenessDays:
        summary.averageLatenessMs === null
          ? null
          : Math.floor(summary.averageLatenessMs / 86_400_000),
      detail: summary.detail,
    };
  }
}

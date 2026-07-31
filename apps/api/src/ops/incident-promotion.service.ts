import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  judgeIncidentPromotion,
  resolvePromotionSettings,
  validateConfirmation,
  validateDismissal,
} from "@acos/core";
import type { PromotableAlert } from "@acos/core";
import type { IncidentDto } from "@acos/shared";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { PrismaService } from "../prisma/prisma.service";
import { IncidentService } from "./incident.service";

/**
 * 경보 → 장애 **초안** 자동 승격. (TASK-3901, Sprint 39 — CTO 정책 3901-⑤)
 *
 * TASK-3701에서 "경보와 장애는 다르다"고 못박았고 그 판단은 지금도
 * 맞습니다. 그런데 반대쪽 실패도 실제로 있었습니다 — **아무도 적지 않아서
 * 이력이 비는 것.** 새벽 3시에 CRITICAL 경보가 40분 살아 있다가 저절로
 * 풀렸다면 그건 장애였는데 기록이 없습니다.
 *
 * 그래서 자동으로 만드는 것은 **초안**입니다. 초안은 "이건 장애였을 수
 * 있습니다, 봐 주세요"라는 질문이고, 사람이 확인하면 장애가 되고 기각하면
 * **사유와 함께** 남습니다.
 *
 * 판정은 `@acos/core`가 하고 여기서는 읽고 쓰기만 합니다.
 */
@Injectable()
export class IncidentPromotionService {
  private readonly logger = new Logger(IncidentPromotionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AdminSettingsService,
    private readonly incidents: IncidentService,
  ) {}

  /** 지금 승격 조건을 만족하는 경보를 초안으로 만든다 */
  async promote(now = Date.now()): Promise<{ created: number; detail: string }> {
    const config = resolvePromotionSettings(this.settings.all());
    if (config.rejected.length > 0) {
      this.logger.warn(
        `받아들이지 않은 승격 설정: ${config.rejected.map((row) => row.reason).join(" · ")}`,
      );
    }

    const [alerts, existing] = await Promise.all([
      this.prisma.alert.findMany({
        where: { level: "CRITICAL" },
        orderBy: { firstRaisedAt: "desc" },
        take: 200,
      }),
      this.prisma.incident.findMany({
        where: { sourceAlertKey: { not: null } },
        select: { sourceAlertKey: true },
      }),
    ]);

    const report = judgeIncidentPromotion({
      alerts: alerts.map(
        (row): PromotableAlert => ({
          key: row.key,
          kind: row.kind,
          level: row.level === "CRITICAL" ? "critical" : "warning",
          status: row.status as PromotableAlert["status"],
          title: row.title,
          message: row.message,
          firstRaisedAt: row.firstRaisedAt.getTime(),
        }),
      ),
      existingSourceKeys: existing
        .map((row) => row.sourceAlertKey)
        .filter((key): key is string => key !== null),
      afterMs: config.afterMs,
      now,
      enabled: config.enabled,
    });

    let created = 0;
    for (const draft of report.drafts) {
      try {
        await this.prisma.incident.create({
          data: {
            component: draft.component,
            severity: draft.severity,
            summary: draft.summary,
            startedAt: draft.startedAt,
            detectedAt: draft.detectedAt,
            status: "DRAFT",
            sourceAlertKey: draft.sourceAlertKey,
            cause: draft.detail,
            // **사람이 연 것이 아니다** — 여는 사람이 없다는 사실을 남긴다
            openedById: null,
          },
        });
        created += 1;
        this.logger.warn(`장애 초안 생성 (경보 ${draft.sourceAlertKey}) — 확인이 필요합니다.`);
      } catch (error) {
        // 유니크 제약에 걸린 것은 다른 인스턴스가 먼저 만든 것이다 — 정상이다
        this.logger.log(`초안 생성 건너뜀 (${draft.sourceAlertKey}): ${String(error)}`);
      }
    }

    return { created, detail: report.detail };
  }

  /**
   * 초안을 장애로 확인한다 (CTO 정책 3901-⑤).
   *
   * 경보 제목을 그대로 두지 못하게 합니다 — 그것은 **경보의 이름**이지
   * 장애의 설명이 아닙니다.
   */
  async confirm(
    id: string,
    input: { summary: string; component?: string; actorId?: string },
  ): Promise<IncidentDto> {
    const row = await this.prisma.incident.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException("그런 장애 기록이 없습니다.");
    }
    const check = validateConfirmation({ status: row.status, summary: input.summary ?? "" });
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    await this.prisma.incident.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        summary: input.summary.trim(),
        ...(input.component ? { component: input.component } : {}),
        openedById: input.actorId ?? null,
      },
    });
    this.logger.warn(`장애 초안 확인 → 장애 [${row.component}] ${input.summary}`);
    return this.incidents.get(id);
  }

  /** 초안을 기각한다 — **사유 없이 기각하지 않습니다** */
  async dismiss(
    id: string,
    input: { reason: string; actorId?: string },
  ): Promise<IncidentDto> {
    const row = await this.prisma.incident.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException("그런 장애 기록이 없습니다.");
    }
    const check = validateDismissal({ status: row.status, reason: input.reason ?? "" });
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    await this.prisma.incident.update({
      where: { id },
      data: {
        status: "DISMISSED",
        dismissedAt: new Date(),
        dismissReason: input.reason.trim(),
        dismissedById: input.actorId ?? null,
      },
    });
    this.logger.log(`장애 초안 기각 [${row.component}] — ${input.reason}`);
    return this.incidents.get(id);
  }
}

import { Injectable, Logger } from "@nestjs/common";
import {
  describeSweep,
  resolveKpiThresholds,
  resolvePromotionSettings,
  resolveRetention,
} from "@acos/core";
import type { RetentionSweep, RetentionTarget } from "@acos/core";
import type { OpsSettingsDto } from "@acos/shared";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "./notification.service";

/**
 * 운영 설정 현황과 보존 정리. (TASK-3901, Sprint 39 — CTO 정책 3901-②③④⑤)
 *
 * 임계값·보존 기간·긴급 경로·자동 승격은 **각자 다른 곳에서 판정**되지만,
 * 운영자에게는 하나의 질문입니다: "지금 이 시스템은 어떤 기준으로 돌고
 * 있는가." 그래서 현황은 한 곳에서 보여 줍니다.
 *
 * 판정은 전부 `@acos/core`가 하고 여기서는 모아 오기만 합니다.
 */
@Injectable()
export class OpsSettingsService {
  private readonly logger = new Logger(OpsSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AdminSettingsService,
    private readonly notifications: NotificationService,
  ) {}

  status(): OpsSettingsDto {
    const all = this.settings.all();
    const thresholds = resolveKpiThresholds(all);
    const retention = resolveRetention(all);
    const promotion = resolvePromotionSettings(all);

    return {
      thresholds: Object.values(thresholds.thresholds).map((row) => ({
        id: row.id,
        title: row.title,
        unit: row.unit,
        direction: row.direction,
        good: row.value.good,
        watch: row.value.watch,
        defaultGood: row.default.good,
        defaultWatch: row.default.watch,
        isDefault: row.isDefault,
        relaxed: row.relaxed,
        min: row.min,
        max: row.max,
      })),
      retention: retention.policies,
      urgentChannels: this.notifications.urgentStatus(),
      promotion: {
        enabled: promotion.enabled,
        afterMinutes: Math.round(promotion.afterMs / 60000),
      },
      // 받아들이지 않은 설정은 **조용히 버리지 않는다**
      rejected: [...thresholds.rejected, ...retention.rejected, ...promotion.rejected],
    };
  }

  /**
   * 보존 기간을 넘긴 기록을 정리한다 (CTO 정책 3901-③).
   *
   * **아무것도 안 지웠어도 결과를 남깁니다** — 나중에 기록이 없을 때
   * "원래 없었나 지워졌나"를 알 수 있어야 하고, 없어진 기록은 스스로
   * 말하지 못합니다.
   */
  async sweep(now = new Date()): Promise<{ sweeps: RetentionSweep[]; detail: string }> {
    const { policies, rejected } = resolveRetention(this.settings.all());
    if (rejected.length > 0) {
      this.logger.warn(
        `받아들이지 않은 보존 설정: ${rejected.map((row) => row.reason).join(" · ")}`,
      );
    }

    const sweeps: RetentionSweep[] = [];
    for (const policy of policies) {
      const cutoff = new Date(now.getTime() - policy.days * 24 * 60 * 60 * 1000);
      const deleted = await this.deleteOlderThan(policy.target, cutoff);
      sweeps.push({
        target: policy.target,
        title: policy.title,
        days: policy.days,
        deleted,
        cutoff: cutoff.toISOString(),
      });
    }

    const detail = describeSweep(sweeps);
    this.logger.log(`보존 정리: ${detail}`);
    return { sweeps, detail };
  }

  private async deleteOlderThan(target: RetentionTarget, cutoff: Date): Promise<number> {
    try {
      if (target === "ops-audit") {
        const result = await this.prisma.opsAuditLog.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
        return result.count;
      }
      const result = await this.prisma.opsEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return result.count;
    } catch (error) {
      // 정리 실패가 다른 정리를 막지 않는다 — 다만 조용하지도 않다
      this.logger.warn(`보존 정리 실패 (${target}): ${String(error)}`);
      return 0;
    }
  }
}

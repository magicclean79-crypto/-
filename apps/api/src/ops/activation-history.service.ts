import { Injectable, Logger } from "@nestjs/common";
import {
  activationSignature,
  summarizeActivationHistory,
} from "@acos/core";
import type {
  ActivationConditionId,
  ActivationHistoryEntry,
  ActivationReport,
  ActivationSnapshot,
} from "@acos/core";
import type { ActivationHistoryDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

/** 이력에 남길 만큼 오래 지켜본 시각 차 — 같은 상태를 1초에 열 번 봐도 한 줄 */
@Injectable()
export class ActivationHistoryService {
  private readonly logger = new Logger(ActivationHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 이번 판정을 이력에 반영한다 (CTO 정책 3701-①).
   *
   * 상태가 **바뀌었을 때만** 새 줄을 만듭니다. 같은 상태면 마지막 관측 시각과
   * 관측 횟수만 갱신합니다 — 그래야 이력에서 변화가 보입니다.
   *
   * 기록 실패가 판정을 막지 않습니다: 이력은 판정의 부산물이고, 이력을 못
   * 남겼다고 화면이 안 뜨면 그것이 더 큰 사고입니다. 대신 조용히 지나가지
   * 않도록 경고를 남깁니다.
   */
  async record(report: ActivationReport): Promise<void> {
    const signature = activationSignature(report);
    try {
      const last = await this.prisma.activationEvent.findFirst({
        orderBy: { recordedAt: "desc" },
      });

      if (last !== null && last.signature === signature) {
        await this.prisma.activationEvent.update({
          where: { id: last.id },
          data: { lastSeenAt: new Date(), observations: { increment: 1 }, detail: report.detail },
        });
        return;
      }

      await this.prisma.activationEvent.create({
        data: {
          signature,
          activated: report.activated,
          met: report.conditions.filter((c) => c.met).map((c) => c.id),
          environment: report.environment,
          detail: report.detail,
        },
      });
      this.logger.log(`활성화 상태 변화 기록: ${signature}`);
    } catch (error) {
      this.logger.warn(`활성화 이력 기록 실패 (판정은 계속합니다): ${String(error)}`);
    }
  }

  /**
   * 마지막으로 기록된 상태 (CTO 정책 3801-①).
   *
   * 이벤트 판정이 "직전에 무엇이었나"를 알아야 전이를 가릴 수 있습니다.
   * 기록이 없으면 `null`이며, 그때 이벤트는 나지 않습니다 — 우리가 못 보고
   * 있는 동안 이미 그 상태였을 수 있고, "방금 완료됐다"고 알리면
   * 거짓말이 됩니다.
   */
  async snapshot(): Promise<ActivationSnapshot | null> {
    try {
      const last = await this.prisma.activationEvent.findFirst({
        orderBy: { recordedAt: "desc" },
      });
      if (last === null) {
        return null;
      }
      return {
        activated: last.activated,
        met: last.met as ActivationConditionId[],
        environment: last.environment,
        applicable: true,
      };
    } catch (error) {
      this.logger.warn(`활성화 직전 상태를 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }

  /** 시간순 이력 (CTO 정책 3701-①) */
  async history(limit = 50): Promise<ActivationHistoryDto> {
    const rows = await this.prisma.activationEvent.findMany({
      orderBy: { recordedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });

    const entries: ActivationHistoryEntry[] = rows.map((row) => ({
      recordedAt: row.recordedAt,
      lastSeenAt: row.lastSeenAt,
      observations: row.observations,
      activated: row.activated,
      signature: row.signature,
      met: row.met as ActivationConditionId[],
      environment: row.environment,
      detail: row.detail,
    }));

    const summary = summarizeActivationHistory(entries);
    const take = Math.min(Math.max(limit, 1), 200);
    const truncated = rows.length >= take;

    return {
      // 화면은 최신이 위다 — 판정은 시간순으로 하고 표시만 뒤집는다.
      //
      // 잘린 창의 **가장 오래된 줄**에서는 증감을 말하지 않는다: 그 앞을
      // 읽지 않았으므로 "이때 세 조건이 생겼다"고 말할 근거가 없다.
      timeline: [...summary.timeline].reverse().map((item, index, all) => ({
        recordedAt: item.recordedAt.toISOString(),
        lastSeenAt: item.lastSeenAt.toISOString(),
        observations: item.observations,
        activated: item.activated,
        met: item.met,
        environment: item.environment,
        detail: item.detail,
        heldMs: item.heldMs,
        ongoing: item.ongoing,
        unobservedMs: item.unobservedMs,
        gained: truncated && index === all.length - 1 ? [] : item.gained,
        lost: truncated && index === all.length - 1 ? [] : item.lost,
      })),
      activated: summary.activated,
      currentSince: summary.currentSince?.toISOString() ?? null,
      firstActivatedAt: summary.firstActivatedAt?.toISOString() ?? null,
      changes: summary.changes,
      regressions: summary.regressions,
      detail: summary.detail,
      /**
       * 잘린 이력인가 — `limit`만큼만 읽었으면 "변화가 이만큼이었다"가
       * 아니라 "최근 이만큼을 봤다"이다.
       */
      truncated,
    };
  }
}

import { Injectable, Logger } from "@nestjs/common";
import {
  KPI_IDS,
  THRESHOLD_SPECS,
  judgeKpiTrend,
  resolveKpiThresholds,
  shouldTakeSnapshot,
  summarizeKpiTrends,
} from "@acos/core";
import type {
  KpiId,
  KpiSnapshot,
  ThresholdDirection,
  ThresholdKpiId,
  ThresholdSpec,
} from "@acos/core";
import type { KpiSettingChangeDto, KpiTrendReportDto } from "@acos/shared";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { PrismaService } from "../prisma/prisma.service";
import { KpiService } from "./kpi.service";

/** 추세를 보는 창 — 지표는 창을 밝히지 않으면 아무 뜻이 없다 */
export const TREND_WINDOW_DAYS = 30;

/**
 * KPI 추세와 임계값 변경 이력. (TASK-4001, Sprint 40 — CTO 정책 4001-②③)
 *
 * 판정은 전부 `@acos/core`가 하고 여기서는 찍고 읽어 오기만 합니다.
 */
@Injectable()
export class KpiTrendService {
  private readonly logger = new Logger(KpiTrendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
    private readonly settings: AdminSettingsService,
  ) {}

  /**
   * 오늘 스냅샷을 찍는다 (CTO 정책 4001-②).
   *
   * 하루 한 번으로 제한하는 이유는 순수 함수 쪽에 적어 두었습니다 — 화면을
   * 열 때마다 찍으면 **사람이 많이 본 날의 표본이 많아져** 추세가 그날로
   * 기웁니다. 그래서 이 메서드는 예약 점검이 부르고, 이미 찍었으면
   * 아무것도 하지 않습니다.
   */
  async snapshot(now = Date.now()): Promise<{ taken: boolean; detail: string }> {
    const last = await this.prisma.kpiSnapshot
      .findFirst({ orderBy: { takenAt: "desc" }, select: { takenAt: true } })
      .catch(() => null);

    if (!shouldTakeSnapshot(last?.takenAt.getTime() ?? null, now)) {
      return {
        taken: false,
        detail: "오늘 스냅샷이 이미 있습니다 — 하루 한 번만 찍습니다.",
      };
    }

    const report = await this.kpi.report();
    const takenAt = new Date(now);
    // **그때 쓰인 임계값을 함께 적는다** — 나중에 기준이 바뀌면 값은
    // 비교할 수 있어도 상태는 비교할 수 없고, 그 사실은 지금 적어 두지
    // 않으면 복원할 수 없다
    const { thresholds } = resolveKpiThresholds(this.settings.all());

    // **값을 낼 수 없었던 지표도 줄을 만든다** — 빼면 나중에 "그날은 좋았다"가
    // 되고, 실제로는 "그날은 몰랐다"였다
    await this.prisma.kpiSnapshot.createMany({
      data: report.kpis.map((row) => {
        const threshold = thresholds[row.id as ThresholdKpiId] as
          | (typeof thresholds)[ThresholdKpiId]
          | undefined;
        return {
          kpiId: row.id,
          value: row.value,
          status: row.status,
          thresholdGood: threshold?.value.good ?? null,
          thresholdWatch: threshold?.value.watch ?? null,
          takenAt,
        };
      }),
    });

    this.logger.log(`KPI 스냅샷 ${report.kpis.length}건을 기록했습니다.`);
    return { taken: true, detail: `지표 ${report.kpis.length}개를 기록했습니다.` };
  }

  /** 최근 창의 추세 (CTO 정책 4001-②) */
  async trend(windowDays = TREND_WINDOW_DAYS): Promise<KpiTrendReportDto> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.kpiSnapshot.findMany({
      where: { takenAt: { gte: since } },
      orderBy: { takenAt: "asc" },
    });

    const byKpi = new Map<string, KpiSnapshot[]>();
    for (const row of rows) {
      const list = byKpi.get(row.kpiId) ?? [];
      list.push({
        kpiId: row.kpiId as KpiId,
        value: row.value,
        status: row.status as KpiSnapshot["status"],
        thresholdGood: row.thresholdGood,
        thresholdWatch: row.thresholdWatch,
        takenAt: row.takenAt.getTime(),
      });
      byKpi.set(row.kpiId, list);
    }

    const titles: Record<string, string> = {};
    const trends = KPI_IDS.map((id) => {
      const spec = THRESHOLD_SPECS.find((row) => row.id === id);
      const title = spec?.title ?? id;
      titles[id] = title;
      return {
        trend: judgeKpiTrend({
          kpiId: id,
          snapshots: byKpi.get(id) ?? [],
          // 임계값이 없는 지표도 추세는 있다 — 그때는 "클수록 좋다"로 본다
          direction: (spec?.direction ?? "higher-is-better") as ThresholdDirection,
          title,
          unit: spec?.unit ?? "",
        }),
        unit: spec?.unit ?? "",
        title,
      };
    });

    const report = summarizeKpiTrends(
      trends.map((row) => row.trend),
      windowDays,
      titles,
    );

    return {
      trends: trends.map((row) => ({
        kpiId: row.trend.kpiId,
        title: row.title,
        direction: row.trend.direction,
        delta: row.trend.delta,
        unit: row.unit,
        comparedTo:
          row.trend.comparedTo === null
            ? null
            : new Date(row.trend.comparedTo).toISOString(),
        samples: row.trend.samples,
        thresholdChanged: row.trend.thresholdChanged,
        detail: row.trend.detail,
      })),
      windowDays: report.windowDays,
      improving: report.improving,
      worsening: report.worsening,
      unknown: report.unknown,
      thresholdChanged: report.thresholdChanged,
      lastTakenAt: rows.length === 0 ? null : rows[rows.length - 1].takenAt.toISOString(),
      detail: report.detail,
    };
  }

  /**
   * 임계값 변경 이력 (CTO 정책 4001-③).
   *
   * 설정 변경은 이미 `AdminAuditLog`에 남고 있었습니다. 그런데 그 목록은
   * 모든 설정이 섞여 있어 **임계값이 언제 왜 움직였는지**를 찾으려면
   * 사람이 눈으로 골라야 했습니다. 임계값은 화면 색을 바꾸는 설정이므로
   * 따로 볼 수 있어야 합니다.
   *
   * 그리고 각 줄에 **느슨해진 변경인지**를 붙입니다 — 그러지 않으면 목록이
   * "60 → 600"만 보여 주고, 그 숫자가 좋은 소식인지 나쁜 소식인지는 다시
   * 사람이 계산해야 합니다.
   */
  async settingHistory(take = 50): Promise<KpiSettingChangeDto[]> {
    const rows = await this.prisma.adminAuditLog.findMany({
      where: { key: { startsWith: "kpi.threshold." } },
      orderBy: { createdAt: "desc" },
      take,
    });

    return rows.map((row) => {
      const match = /^kpi\.threshold\.([a-z-]+)\.(good|watch)$/.exec(row.key);
      const spec =
        match === null ? undefined : THRESHOLD_SPECS.find((item) => item.id === match[1]);
      const bound = match?.[2] === "good" ? "정상 경계" : "주의 경계";

      return {
        id: row.id,
        key: row.key,
        title: spec === undefined ? row.key : `${spec.title} ${bound}`,
        action: row.action,
        before: row.before,
        after: row.after,
        actor: row.actor,
        relaxed: judgeRelaxed(spec, match?.[2] as "good" | "watch" | undefined, row.before, row.after),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}

/**
 * 이 변경이 기준을 느슨하게 했는가 — 판정할 수 없으면 null.
 *
 * **`null`을 `false`로 바꾸지 않습니다.** "느슨하지 않았다"와 "느슨해졌는지
 * 모른다"는 다른 사실이고, 둘을 같게 적으면 목록이 안전해 보입니다.
 *
 * 그리고 **없는 값은 기본값입니다** (라이브 검증에서 고침). 감사 기록의
 * `before`는 오버라이드가 없었으면 `null`인데, 그때 실제로 쓰이던 기준은
 * 없었던 것이 아니라 **기본값**이었습니다. 이것을 "판정할 수 없음"으로
 * 두면 **처음으로 기준을 느슨하게 바꾼 변경** — 이 기능이 잡으려는 바로
 * 그 경우 — 이 목록에서 회색으로 지나갑니다. `after`가 null인 것(해제)도
 * 같습니다: 기본값으로 되돌아간 것이고, 되돌아간 방향은 판정할 수 있습니다.
 */
function judgeRelaxed(
  spec: ThresholdSpec | undefined,
  bound: "good" | "watch" | undefined,
  before: string | null,
  after: string | null,
): boolean | null {
  if (spec === undefined || bound === undefined) {
    return null;
  }
  const fallback = spec.default[bound];
  const from = before === null ? fallback : Number(before);
  const to = after === null ? fallback : Number(after);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    return null;
  }
  return spec.direction === "lower-is-better" ? to > from : to < from;
}

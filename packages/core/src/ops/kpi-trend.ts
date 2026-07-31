/**
 * KPI 추세. (TASK-4001, Sprint 40 — CTO 정책 4001-②)
 *
 * TASK-3801의 KPI는 **현재값만** 말합니다. 그런데 "MTTR 180분"은 그 자체로는
 * 아무 행동도 만들지 않습니다. 사람이 알아야 하는 것은 **"나아지는 중인가
 * 나빠지는 중인가"** 이고, 그건 두 번 재야 알 수 있습니다.
 *
 * ## 추세가 거짓말하는 세 가지 방식
 *
 * **1. 한 점으로 선을 긋는다.** 스냅샷이 하나뿐이면 추세는 없습니다.
 * "0% 변화"로 적으면 안정적이라는 뜻이 되는데, 실제로는 아무것도 모릅니다.
 *
 * **2. 기준이 바뀐 구간을 비교한다.** 지난주에 임계값을 느슨하게 바꿨다면
 * `watch → good`은 **상태가 좋아진 것이 아니라 기준이 내려간 것**입니다
 * (정책 3901-②에서 세운 원칙). 값은 비교할 수 있어도 **상태는 비교할 수
 * 없습니다.**
 *
 * **3. 방향을 모른다.** MTTR이 늘면 나빠진 것이고 통과율이 늘면 좋아진
 * 것입니다. 방향을 안 보면 "증가"를 좋은 소식으로 읽습니다.
 *
 * ## 스냅샷은 하루 한 번
 *
 * 화면을 열 때마다 찍으면 사람이 많이 본 날의 표본이 많아져 평균이 그날로
 * 기웁니다. 하루 한 번이 이 지표들의 성격에 맞습니다.
 */

import type { KpiId, KpiStatus } from "./kpi";
import type { ThresholdDirection } from "./kpi-thresholds";

/** 저장된 스냅샷 한 점 */
export interface KpiSnapshot {
  kpiId: KpiId;
  /** 그때 값 — 표본이 없었으면 null */
  value: number | null;
  status: KpiStatus;
  /** 그때 쓰인 임계값 — 바뀌었으면 상태는 비교할 수 없다 */
  thresholdGood: number | null;
  thresholdWatch: number | null;
  takenAt: number;
}

export type TrendDirection = "improving" | "worsening" | "flat" | "unknown";

export interface KpiTrend {
  kpiId: KpiId;
  direction: TrendDirection;
  /** 값 변화 — 비교할 수 없으면 null */
  delta: number | null;
  /** 비교 대상 시점 */
  comparedTo: number | null;
  /** 표본 수 (스냅샷 개수) */
  samples: number;
  /**
   * 이 구간에 임계값이 바뀌었는가 — 바뀌었으면 **상태 변화는 추세가
   * 아닙니다**(기준이 움직인 것입니다).
   */
  thresholdChanged: boolean;
  detail: string;
}

/**
 * 한 지표의 추세를 낸다 (순수 함수, CTO 정책 4001-②).
 *
 * `snapshots`는 **오래된 것부터** 들어옵니다. 마지막 점을 지금으로 보고,
 * 창의 첫 점과 비교합니다.
 */
export function judgeKpiTrend(input: {
  kpiId: KpiId;
  snapshots: KpiSnapshot[];
  direction: ThresholdDirection;
  title: string;
  unit: string;
}): KpiTrend {
  const points = [...input.snapshots].sort((a, b) => a.takenAt - b.takenAt);

  if (points.length < 2) {
    return {
      kpiId: input.kpiId,
      direction: "unknown",
      delta: null,
      comparedTo: null,
      samples: points.length,
      thresholdChanged: false,
      // **한 점으로는 선을 긋지 않는다** — "0% 변화"는 안정을 뜻하는데
      // 실제로는 아무것도 모르는 상태다
      detail:
        points.length === 0
          ? "기록된 스냅샷이 없습니다 — 추세를 낼 수 없습니다."
          : "스냅샷이 1개뿐입니다 — 한 점으로는 추세가 아닙니다.",
    };
  }

  const first = points[0];
  const last = points[points.length - 1];

  const thresholdChanged =
    first.thresholdGood !== last.thresholdGood ||
    first.thresholdWatch !== last.thresholdWatch;

  if (first.value === null || last.value === null) {
    return {
      kpiId: input.kpiId,
      direction: "unknown",
      delta: null,
      comparedTo: first.takenAt,
      samples: points.length,
      thresholdChanged,
      detail:
        "비교 구간에 값을 낼 수 없었던 시점이 있습니다 — 표본이 없는 것을 " +
        "0으로 보지 않으므로 추세도 내지 않습니다.",
    };
  }

  const delta = Math.round((last.value - first.value) * 10) / 10;
  const direction: TrendDirection =
    delta === 0
      ? "flat"
      : input.direction === "lower-is-better"
        ? delta < 0
          ? "improving"
          : "worsening"
        : delta > 0
          ? "improving"
          : "worsening";

  const sign = delta > 0 ? "+" : "";
  const parts = [
    `${input.title} ${first.value}${input.unit} → ${last.value}${input.unit} ` +
      `(${sign}${delta}${input.unit}, 표본 ${points.length}개)`,
  ];
  if (thresholdChanged) {
    // 정책 3901-②에서 세운 원칙의 연장선: 기준이 움직였으면 색의 변화는
    // 상태의 변화가 아니다
    parts.push(
      "이 구간에 임계값이 바뀌었습니다 — 값은 비교할 수 있지만 " +
        "정상/주의/나쁨의 변화는 상태가 아니라 기준이 움직인 결과입니다.",
    );
  }

  return {
    kpiId: input.kpiId,
    direction,
    delta,
    comparedTo: first.takenAt,
    samples: points.length,
    thresholdChanged,
    detail: parts.join(" "),
  };
}

export interface TrendReport {
  trends: KpiTrend[];
  windowDays: number;
  improving: number;
  worsening: number;
  /** 추세를 낼 수 없는 지표 수 — 이것이 많으면 추세 화면을 믿을 수 없다 */
  unknown: number;
  /** 기준이 움직인 지표 수 */
  thresholdChanged: number;
  detail: string;
}

/** 여러 지표의 추세를 요약한다 (순수 함수) */
export function summarizeKpiTrends(
  trends: KpiTrend[],
  windowDays: number,
  titles: Record<string, string>,
): TrendReport {
  const improving = trends.filter((row) => row.direction === "improving").length;
  const worsening = trends.filter((row) => row.direction === "worsening").length;
  const unknown = trends.filter((row) => row.direction === "unknown").length;
  const thresholdChanged = trends.filter((row) => row.thresholdChanged).length;

  const parts: string[] = [`최근 ${windowDays}일 추세.`];
  if (worsening > 0) {
    // 나빠지는 것을 **먼저** 말한다 — 좋아진 것 뒤에 붙이면 안 읽힌다
    parts.push(
      `나빠지는 중 ${worsening}개: ${trends
        .filter((row) => row.direction === "worsening")
        .map((row) => titles[row.kpiId] ?? row.kpiId)
        .join(" · ")}.`,
    );
  }
  if (improving > 0) {
    parts.push(`나아지는 중 ${improving}개.`);
  }
  if (unknown > 0) {
    parts.push(
      `추세를 낼 수 없는 지표 ${unknown}개 — 표본이 부족하거나 값을 낼 수 ` +
        "없었던 시점이 있습니다.",
    );
  }
  if (thresholdChanged > 0) {
    parts.push(
      `이 구간에 임계값이 바뀐 지표 ${thresholdChanged}개 — 색의 변화를 ` +
        "상태의 변화로 읽지 마세요.",
    );
  }

  return {
    trends,
    windowDays,
    improving,
    worsening,
    unknown,
    thresholdChanged,
    detail: parts.join(" "),
  };
}

/**
 * 오늘 이미 스냅샷을 찍었는가 (순수 함수).
 *
 * 하루 한 번으로 두는 이유: 화면을 열 때마다 찍으면 **사람이 많이 본 날의
 * 표본이 많아져** 추세가 그날로 기웁니다.
 */
export function shouldTakeSnapshot(lastTakenAt: number | null, now: number): boolean {
  if (lastTakenAt === null) {
    return true;
  }
  return now - lastTakenAt >= 20 * 60 * 60 * 1000;
}

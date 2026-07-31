/**
 * 운영 KPI. (TASK-3801, Sprint 38 — CTO 정책 3801-③)
 *
 * 우리에겐 이미 판정이 많습니다 — 활성화, 전환, 스모크, 장애, 경보, CI,
 * 예약 점검. 문제는 그것들이 **각자 다른 화면에 흩어져 있다**는 것이고,
 * 그래서 "우리 운영은 지금 잘 돌고 있는가"라는 한 문장짜리 질문에 답하려면
 * 사람이 일곱 군데를 돌아야 합니다. 안 돌면 안 보고, 안 보면 나빠지는 것을
 * 늦게 압니다.
 *
 * ## KPI가 거짓말하는 두 가지 방식
 *
 * **1. 표본이 없는데 숫자가 나온다.** 복구된 장애가 하나도 없을 때 평균
 * 복구 시간을 `0분`으로 적으면 그것은 "우리는 매우 빠르다"로 읽힙니다.
 * 실제로는 아무것도 모르는 상태입니다. 그래서 모든 지표는 `number | null`
 * 이고, **`null`은 0이 아니라 "낼 수 없음"** 으로 표시합니다.
 *
 * **2. 좋아 보이는 0.** "장애 0건"은 장애가 없었다는 뜻일 수도, **아무도
 * 적지 않았다**는 뜻일 수도 있습니다(장애는 사람이 엽니다 — 정책 3701-④).
 * "경보 0건"은 조용했다는 뜻일 수도, 감시가 꺼져 있었다는 뜻일 수도
 * 있습니다. 그래서 각 지표는 **`caveat`(이 숫자가 거짓말할 수 있는 지점)**
 * 을 함께 답니다. 대시보드가 사람을 안심시키는 도구가 되면, 그 대시보드는
 * 없는 편이 낫습니다.
 *
 * ## 관측 창을 밝힌다
 *
 * "통과율 92%"는 언제부터 언제까지인지를 말하지 않으면 아무 뜻이 없습니다.
 * 모든 지표에 창을 답니다.
 */

import { describeThreshold, judgeAgainstThreshold } from "./kpi-thresholds";
import type { ResolvedThreshold, ThresholdKpiId } from "./kpi-thresholds";

export const KPI_IDS = [
  "activation",
  "smoke",
  "incidents-open",
  "mttr",
  "mttd",
  "follow-up",
  "alerts",
  "checks",
  "ci",
] as const;
export type KpiId = (typeof KPI_IDS)[number];

/** 지표 하나의 건강 상태 — **모르면 `unknown`이고, 그것은 좋음이 아니다** */
export type KpiStatus = "good" | "watch" | "bad" | "unknown";

export interface Kpi {
  id: KpiId;
  title: string;
  /** 값 — **표본이 없으면 `null`**(0이 아니다) */
  value: number | null;
  /** 표시 단위 (`%` · `건` · `분` 등) */
  unit: string;
  status: KpiStatus;
  /** 무엇을 세어 나온 값인가 */
  basis: string;
  /** 이 숫자가 거짓말할 수 있는 지점 — 없으면 null */
  caveat: string | null;
  /**
   * 이 지표를 판정한 임계값 설명 (TASK-3901, 정책 3901-②).
   * 기본값이면 `null`, 운영자가 바꿨으면 그 사실과 방향을 말합니다 —
   * **느슨하게 바꾼 것은 "초록을 산 것"이고 숫자만으로는 보이지 않습니다.**
   */
  threshold: string | null;
}

export interface KpiInput {
  windowDays: number;
  activation: {
    /** 기록이 없으면 null — "활성화 안 됨"이 아니라 "모른다" */
    activated: boolean | null;
    met: number;
    total: number;
    applicable: boolean;
    /** 이 상태로 있었던 시간 */
    heldMs: number | null;
    /** 되돌아간 횟수 */
    regressions: number;
  };
  smoke: {
    /** 창 안의 스모크 실행 결과 — 비어 있으면 한 번도 안 돌린 것 */
    results: { status: string }[];
    /** 마지막 실행 시각 (ms) — 없으면 null */
    ranAt: number | null;
  };
  incidents: {
    open: number;
    resolved: number;
    mttrMs: number | null;
    mttdMs: number | null;
    awaitingPermanentFix: number;
  };
  alerts: {
    /** 지금 살아 있는 경보 */
    active: number;
    /** 창 안에서 새로 난 경보 */
    raised: number;
    /** 감시가 돌고 있는가 — 예약 점검이 멈춰 있으면 "0건"은 조용함이 아니다 */
    schedulerRunning: boolean;
  };
  checks: {
    /** 창 안의 예약 점검 실행 */
    total: number;
    ok: number;
  };
  ci: {
    /** 최근 실행 — 비어 있으면 이력을 못 읽은 것 */
    total: number;
    success: number;
  };
  /** 지금 시각 (ms) */
  now: number;
  /** 운영 설정으로 해석된 임계값 (CTO 정책 3901-②) */
  thresholds: Record<ThresholdKpiId, ResolvedThreshold>;
}

export interface KpiReport {
  kpis: Kpi[];
  windowDays: number;
  /** 값을 낼 수 없었던 지표 수 — 이것이 많으면 대시보드를 믿을 수 없다 */
  unknown: number;
  /** 나쁜 지표 수 */
  bad: number;
  /** 기본값이 아닌 임계값으로 판정한 지표 수 */
  adjusted: number;
  /** **느슨하게** 바꾼 임계값으로 판정한 지표 수 — 초록을 산 것이다 */
  relaxed: number;
  detail: string;
  checkedAt: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function percent(part: number, whole: number): number {
  return Math.round((part / whole) * 1000) / 10;
}

/** 임계값이 없는 지표의 카드 (활성화) */
const NO_THRESHOLD = null;

/** 활성화 지표 — 개발 환경에서는 판정 자체가 대상이 아니다 */
function activationKpi(input: KpiInput): Kpi {
  const { activation } = input;
  if (!activation.applicable) {
    return {
      id: "activation",
      title: "운영 활성화",
      value: null,
      unit: "",
      status: "unknown",
      basis: "이 환경은 활성화 대상이 아닙니다 (CTO 정책 3501-①).",
      caveat: "개발 환경의 값을 운영 건강도로 읽지 마세요.",
      threshold: NO_THRESHOLD,
    };
  }
  if (activation.activated === null) {
    return {
      id: "activation",
      title: "운영 활성화",
      value: null,
      unit: "",
      status: "unknown",
      basis: "활성화 이력이 없습니다.",
      caveat: "이력이 없는 것은 '활성화 안 됨'이 아니라 '모른다'입니다.",
      threshold: NO_THRESHOLD,
    };
  }
  return {
    id: "activation",
    title: "운영 활성화",
    value: activation.met,
    unit: `/${activation.total} 조건`,
    status: activation.activated ? "good" : "bad",
    basis: activation.activated
      ? `세 조건이 모두 충족된 채 ${Math.floor((activation.heldMs ?? 0) / HOUR_MS)}시간째입니다.`
      : `충족 ${activation.met}/${activation.total} — 아직 전환되지 않았습니다.`,
    caveat:
      activation.regressions > 0
        ? `되돌아간 적 ${activation.regressions}회 — 조용히 풀리는 조건이 있습니다.`
        : null,
    // 활성화는 셋이 모두 충족될 때만 완료다 (정책 3601-①) — 임계값이 없다
    threshold: NO_THRESHOLD,
  };
}

/** 스모크 지표 — **부르지 않은 것은 통과가 아니다**(정책 3701-②) */
function smokeKpi(input: KpiInput): Kpi {
  const results = input.smoke.results;
  if (results.length === 0) {
    return {
      id: "smoke",
      title: "실 호출 스모크",
      value: null,
      unit: "%",
      status: "unknown",
      basis: "창 안에 스모크 실행이 없습니다.",
      caveat: "한 번도 부르지 않은 것을 '문제 없음'으로 읽지 마세요.",
      threshold: describeThreshold(input.thresholds.smoke),
    };
  }
  const passed = results.filter((row) => row.status === "passed").length;
  const stubbed = results.filter((row) => row.status === "stubbed").length;
  const ratio = percent(passed, results.length);
  const stale =
    input.smoke.ranAt !== null && input.now - input.smoke.ranAt > 7 * DAY_MS;
  return {
    id: "smoke",
    title: "실 호출 스모크",
    value: ratio,
    unit: "%",
    status: judgeAgainstThreshold(ratio, input.thresholds.smoke),
    basis: `실행 ${results.length}건 중 공식 주소로 통과 ${passed}건.`,
    caveat:
      stubbed > 0
        ? `${stubbed}건은 스텁 응답이라 통과로 세지 않았습니다.`
        : stale
          ? "마지막 실행이 7일을 넘었습니다 — 지금도 되는지는 모릅니다."
          : null,
    threshold: describeThreshold(input.thresholds.smoke),
  };
}

function openIncidentsKpi(input: KpiInput): Kpi {
  const { incidents } = input;
  return {
    id: "incidents-open",
    title: "진행 중인 장애",
    value: incidents.open,
    unit: "건",
    status: judgeAgainstThreshold(incidents.open, input.thresholds["incidents-open"]),
    basis: `지금 열려 있는 장애 ${incidents.open}건.`,
    caveat:
      incidents.open === 0 && incidents.resolved === 0
        ? "기록된 장애가 하나도 없습니다 — 장애가 없었다는 뜻일 수도, 아무도 적지 않았다는 뜻일 수도 있습니다."
        : null,
    threshold: describeThreshold(input.thresholds["incidents-open"]),
  };
}

function durationKpi(
  id: "mttr" | "mttd",
  title: string,
  ms: number | null,
  basisWhenKnown: string,
  caveat: string | null,
  threshold: ResolvedThreshold,
): Kpi {
  if (ms === null) {
    return {
      id,
      title,
      value: null,
      unit: "분",
      status: "unknown",
      // 표본이 없으면 0분이 아니라 "낼 수 없음"이다 — 0분은 "빨랐다"로 읽힌다
      basis: "표본이 없어 평균을 낼 수 없습니다.",
      caveat: "0분이 아니라 '모른다'입니다.",
      threshold: describeThreshold(threshold),
    };
  }
  const minutes = Math.round(ms / 60000);
  return {
    id,
    title,
    value: minutes,
    unit: "분",
    status: judgeAgainstThreshold(minutes, threshold),
    basis: basisWhenKnown,
    caveat,
    threshold: describeThreshold(threshold),
  };
}

function followUpKpi(input: KpiInput): Kpi {
  const count = input.incidents.awaitingPermanentFix;
  return {
    id: "follow-up",
    title: "영구 조치 대기",
    value: count,
    unit: "건",
    status: judgeAgainstThreshold(count, input.thresholds["follow-up"]),
    basis: `임시 조치로 닫힌 뒤 영구 조치를 기다리는 장애 ${count}건.`,
    caveat:
      count > 0
        ? "목록에서는 '복구됨'으로 보이지만 원인은 그대로 있습니다."
        : null,
    threshold: describeThreshold(input.thresholds["follow-up"]),
  };
}

function alertsKpi(input: KpiInput): Kpi {
  const { alerts } = input;
  // **감시가 멈춰 있으면 이 숫자는 지금을 말하지 않는다.**
  //
  // 라이브 검증에서 활성 경보 7건에 "이 숫자가 낮은 것은 조용해서가
  // 아니라"가 붙었습니다 — 숫자가 높은데 낮다고 말하는 주석입니다.
  // 문구가 값과 어긋나면 사람은 주석 전체를 무시하게 되고, 그러면 정작
  // 0건일 때의 경고도 안 읽힙니다.
  if (!alerts.schedulerRunning) {
    return {
      id: "alerts",
      title: "활성 경보",
      value: alerts.active,
      unit: "건",
      status: "unknown",
      basis: `지금 살아 있는 경보 ${alerts.active}건.`,
      caveat:
        alerts.active === 0
          ? "예약 점검이 돌고 있지 않습니다 — 이 숫자가 0인 것은 조용해서가 " +
            "아니라 아무도 보고 있지 않아서일 수 있습니다."
          : "예약 점검이 돌고 있지 않아 이 목록이 갱신되지 않습니다 — 이미 " +
            "풀린 문제가 남아 있을 수도, 새 문제가 아직 안 잡혔을 수도 있습니다.",
      threshold: describeThreshold(input.thresholds.alerts),
    };
  }
  return {
    id: "alerts",
    title: "활성 경보",
    value: alerts.active,
    unit: "건",
    status: judgeAgainstThreshold(alerts.active, input.thresholds.alerts),
    basis: `지금 ${alerts.active}건 · 창 안에서 새로 난 것 ${alerts.raised}건.`,
    caveat: null,
    threshold: describeThreshold(input.thresholds.alerts),
  };
}

function ratioKpi(
  id: "checks" | "ci",
  title: string,
  ok: number,
  total: number,
  emptyBasis: string,
  emptyCaveat: string,
  threshold: ResolvedThreshold,
): Kpi {
  if (total === 0) {
    return {
      id,
      title,
      value: null,
      unit: "%",
      status: "unknown",
      basis: emptyBasis,
      caveat: emptyCaveat,
      threshold: describeThreshold(threshold),
    };
  }
  const ratio = percent(ok, total);
  return {
    id,
    title,
    value: ratio,
    unit: "%",
    status: judgeAgainstThreshold(ratio, threshold),
    basis: `${total}회 중 ${ok}회 통과.`,
    caveat: null,
    threshold: describeThreshold(threshold),
  };
}

/**
 * 운영 KPI를 낸다 (순수 함수, CTO 정책 3801-③).
 *
 * **`unknown`을 좋음으로 세지 않습니다.** 요약 문장은 모르는 지표가 몇
 * 개인지를 먼저 말합니다 — 절반을 모르는 대시보드를 초록으로 보여 주면
 * 그것이 가장 위험한 화면이 됩니다.
 */
export function summarizeOperationsKpi(input: KpiInput): KpiReport {
  const kpis: Kpi[] = [
    activationKpi(input),
    smokeKpi(input),
    openIncidentsKpi(input),
    durationKpi(
      "mttr",
      "평균 복구 시간",
      input.incidents.mttrMs,
      `복구된 장애 ${input.incidents.resolved}건의 평균입니다 (진행 중인 것은 넣지 않습니다).`,
      null,
      input.thresholds.mttr,
    ),
    durationKpi(
      "mttd",
      "평균 감지 시간",
      input.incidents.mttdMs,
      "알아챈 시각이 적힌 장애의 평균입니다.",
      "이 값이 크면 고칠 곳은 복구 절차가 아니라 감시입니다.",
      input.thresholds.mttd,
    ),
    followUpKpi(input),
    alertsKpi(input),
    ratioKpi(
      "checks",
      "예약 점검 통과율",
      input.checks.ok,
      input.checks.total,
      "창 안에 예약 점검 실행이 없습니다.",
      "점검이 꺼져 있거나 인스턴스가 뜬 지 얼마 안 된 것입니다.",
      input.thresholds.checks,
    ),
    ratioKpi(
      "ci",
      "CI 통과율",
      input.ci.success,
      input.ci.total,
      "실행 이력을 읽지 못했습니다.",
      "이력을 못 읽은 것은 '한 번도 안 깨졌다'가 아닙니다.",
      input.thresholds.ci,
    ),
  ];

  const unknown = kpis.filter((kpi) => kpi.status === "unknown").length;
  const bad = kpis.filter((kpi) => kpi.status === "bad").length;
  const thresholdRows = Object.values(input.thresholds);
  const adjusted = thresholdRows.filter((row) => !row.isDefault).length;
  const relaxed = thresholdRows.filter((row) => row.relaxed).length;

  const parts: string[] = [`최근 ${input.windowDays}일 기준.`];
  if (bad > 0) {
    parts.push(
      `나쁨 ${bad}개: ${kpis
        .filter((kpi) => kpi.status === "bad")
        .map((kpi) => kpi.title)
        .join(" · ")}.`,
    );
  }
  if (unknown > 0) {
    parts.push(
      `값을 낼 수 없는 지표 ${unknown}개: ${kpis
        .filter((kpi) => kpi.status === "unknown")
        .map((kpi) => kpi.title)
        .join(" · ")} — 모르는 것을 좋음으로 세지 않습니다.`,
    );
  }
  if (bad === 0 && unknown === 0) {
    parts.push("모든 지표가 정상 범위입니다.");
  }
  // **느슨하게 바꾼 임계값은 요약에서 먼저 말한다** (정책 3901-②).
  // 초록이 늘어난 이유가 운영이 나아져서인지 기준이 내려가서인지를
  // 화면이 구분해 주지 않으면, 대시보드는 스스로를 속이는 도구가 된다.
  if (relaxed > 0) {
    parts.push(
      `임계값을 **느슨하게** 바꾼 지표 ${relaxed}개 — 기준을 내린 것이지 ` +
        "상태가 좋아진 것이 아닙니다.",
    );
  } else if (adjusted > 0) {
    parts.push(`운영자가 조정한 임계값 ${adjusted}개 (기본값보다 엄격합니다).`);
  }

  return {
    kpis,
    windowDays: input.windowDays,
    unknown,
    bad,
    adjusted,
    relaxed,
    detail: parts.join(" "),
    checkedAt: new Date(input.now).toISOString(),
  };
}

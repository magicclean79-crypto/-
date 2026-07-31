/**
 * KPI 임계값 운영 설정. (TASK-3901, Sprint 39 — CTO 정책 3901-②)
 *
 * TASK-3801의 임계값은 코드 상수였습니다(MTTR 60분/240분, 통과율 95%/80%).
 * 조직마다 "괜찮음"의 기준이 다르므로 운영자가 바꿀 수 있어야 합니다.
 *
 * ## 그런데 임계값은 바꾸면 화면 색이 바뀝니다
 *
 * 이 기능의 위험은 명백합니다: **MTTR 임계값을 240분에서 600분으로 올리면
 * 아무것도 나아지지 않았는데 대시보드가 초록이 됩니다.** 그리고 그 초록을
 * 본 사람은 "우리 운영 괜찮네"라고 생각합니다.
 *
 * 그래서 세 가지를 함께 넣습니다:
 *
 * 1. **기본값이 아닌 임계값은 그렇다고 표시합니다.** 지표 카드가 "운영자
 *    조정값"이라고 말합니다 — 숫자만 보고 판단하지 못하게.
 * 2. **느슨하게 바꾼 것과 엄격하게 바꾼 것을 가릅니다.** 엄격하게 바꾼 것은
 *    스스로에게 높은 기준을 세운 것이고, **느슨하게 바꾼 것은 초록을 산
 *    것**입니다. 둘을 같게 표시하면 구분이 사라집니다.
 * 3. **범위를 둡니다.** MTTR 임계값을 30일로 두는 것은 임계값이 아니라
 *    임계값을 없앤 것입니다 — 그건 설정이 아니라 우회입니다.
 */

/** 임계값을 가진 지표 — 나머지는 값 자체가 상태를 정한다 */
export const THRESHOLD_KPIS = [
  "mttr",
  "mttd",
  "incidents-open",
  "follow-up",
  "alerts",
  "checks",
  "ci",
  "smoke",
] as const;
export type ThresholdKpiId = (typeof THRESHOLD_KPIS)[number];

export interface KpiThreshold {
  /** 이 값 이하(또는 이상)면 정상 */
  good: number;
  /** 이 값 이하(또는 이상)면 주의 — 넘으면 나쁨 */
  watch: number;
}

/**
 * 방향 — 값이 **작을수록 좋은가, 클수록 좋은가**.
 *
 * 이것을 임계값과 함께 두지 않으면 "느슨하게 바꿨는가"를 판정할 수
 * 없습니다. MTTR은 올리는 것이 느슨한 것이고, 통과율은 내리는 것이
 * 느슨한 것입니다.
 */
export type ThresholdDirection = "lower-is-better" | "higher-is-better";

export interface ThresholdSpec {
  id: ThresholdKpiId;
  title: string;
  unit: string;
  direction: ThresholdDirection;
  default: KpiThreshold;
  /** 받아들일 수 있는 범위 — 밖이면 임계값이 아니라 우회다 */
  min: number;
  max: number;
}

export const THRESHOLD_SPECS: ThresholdSpec[] = [
  {
    id: "mttr",
    title: "평균 복구 시간",
    unit: "분",
    direction: "lower-is-better",
    default: { good: 60, watch: 240 },
    min: 5,
    // 하루를 넘는 복구 시간을 "주의"로 두는 것은 기준을 없앤 것이다
    max: 1440,
  },
  {
    id: "mttd",
    title: "평균 감지 시간",
    unit: "분",
    direction: "lower-is-better",
    default: { good: 15, watch: 60 },
    min: 1,
    max: 720,
  },
  {
    id: "incidents-open",
    title: "진행 중인 장애",
    unit: "건",
    direction: "lower-is-better",
    default: { good: 0, watch: 1 },
    min: 0,
    max: 20,
  },
  {
    id: "follow-up",
    title: "영구 조치 대기",
    unit: "건",
    direction: "lower-is-better",
    default: { good: 0, watch: 2 },
    min: 0,
    max: 50,
  },
  {
    id: "alerts",
    title: "활성 경보",
    unit: "건",
    direction: "lower-is-better",
    default: { good: 0, watch: 3 },
    min: 0,
    max: 100,
  },
  {
    id: "checks",
    title: "예약 점검 통과율",
    unit: "%",
    direction: "higher-is-better",
    default: { good: 95, watch: 80 },
    min: 50,
    max: 100,
  },
  {
    id: "ci",
    title: "CI 통과율",
    unit: "%",
    direction: "higher-is-better",
    default: { good: 95, watch: 80 },
    min: 50,
    max: 100,
  },
  {
    id: "smoke",
    title: "실 호출 스모크",
    unit: "%",
    direction: "higher-is-better",
    // 스모크는 셋 다 통과해야 정상이다 (정책 3701-②) — 100 미만은 정상이 아니다
    default: { good: 100, watch: 50 },
    min: 50,
    max: 100,
  },
];

const SPEC_BY_ID = new Map(THRESHOLD_SPECS.map((spec) => [spec.id, spec]));

/** 설정 키 — `kpi.threshold.mttr.good` */
export function thresholdSettingKey(id: ThresholdKpiId, bound: "good" | "watch"): string {
  return `kpi.threshold.${id}.${bound}`;
}

/** 해석된 임계값 하나 */
export interface ResolvedThreshold {
  id: ThresholdKpiId;
  title: string;
  unit: string;
  direction: ThresholdDirection;
  value: KpiThreshold;
  default: KpiThreshold;
  /** 기본값 그대로인가 */
  isDefault: boolean;
  /**
   * 기본값보다 **느슨한가** — 느슨한 것은 "초록을 산 것"이고, 그 사실이
   * 화면에 남아야 합니다.
   */
  relaxed: boolean;
  min: number;
  max: number;
}

/** 설정 값이 성립하는가 — 성립하지 않으면 이유를 돌려준다 */
export function validateThreshold(
  key: string,
  raw: string | null,
): { ok: true } | { ok: false; reason: string } {
  const match = /^kpi\.threshold\.([a-z-]+)\.(good|watch)$/.exec(key);
  if (match === null) {
    return { ok: false, reason: `KPI 임계값 키 형식이 아닙니다: ${key}` };
  }
  const spec = SPEC_BY_ID.get(match[1] as ThresholdKpiId);
  if (spec === undefined) {
    return {
      ok: false,
      reason:
        `임계값을 둘 수 없는 지표입니다: ${match[1]} ` +
        `(${THRESHOLD_KPIS.join(" · ")})`,
    };
  }
  if (raw === null) {
    return { ok: true }; // 지우는 것은 기본값으로 되돌리는 것이다
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `숫자가 아닙니다: ${raw}` };
  }
  if (value < spec.min || value > spec.max) {
    return {
      ok: false,
      reason:
        `${spec.title} 임계값은 ${spec.min}~${spec.max}${spec.unit} 사이여야 ` +
        `합니다 (받은 값: ${value}${spec.unit}). 범위 밖의 값은 임계값이 ` +
        "아니라 임계값을 없앤 것이고, 그건 설정이 아니라 우회입니다.",
    };
  }
  return { ok: true };
}

/**
 * 설정에서 임계값을 해석한다 (순수 함수, CTO 정책 3901-②).
 *
 * 잘못된 값은 **조용히 기본값으로 되돌립니다** — 판정이 멈추는 것보다
 * 낫지만, 그 사실이 `rejected`에 남습니다(조용히 버리지 않습니다).
 */
export function resolveKpiThresholds(settings: Record<string, string>): {
  thresholds: Record<ThresholdKpiId, ResolvedThreshold>;
  /** 기본값이 아닌 것 */
  adjusted: ResolvedThreshold[];
  /** 느슨하게 바꾼 것 — "초록을 산 것" */
  relaxed: ResolvedThreshold[];
  /** 받아들이지 않은 설정 */
  rejected: { key: string; reason: string }[];
} {
  const rejected: { key: string; reason: string }[] = [];
  const thresholds = {} as Record<ThresholdKpiId, ResolvedThreshold>;

  for (const spec of THRESHOLD_SPECS) {
    const value: KpiThreshold = { ...spec.default };
    for (const bound of ["good", "watch"] as const) {
      const key = thresholdSettingKey(spec.id, bound);
      const raw = settings[key];
      if (raw === undefined) {
        continue;
      }
      const check = validateThreshold(key, raw);
      if (!check.ok) {
        rejected.push({ key, reason: check.reason });
        continue;
      }
      value[bound] = Number(raw);
    }

    const isDefault =
      value.good === spec.default.good && value.watch === spec.default.watch;
    thresholds[spec.id] = {
      id: spec.id,
      title: spec.title,
      unit: spec.unit,
      direction: spec.direction,
      value,
      default: spec.default,
      isDefault,
      relaxed: !isDefault && isRelaxed(spec, value),
      min: spec.min,
      max: spec.max,
    };
  }

  const all = Object.values(thresholds);
  return {
    thresholds,
    adjusted: all.filter((row) => !row.isDefault),
    relaxed: all.filter((row) => row.relaxed),
    rejected,
  };
}

/**
 * 기본값보다 통과하기 쉬워졌는가.
 *
 * 둘 중 하나라도 느슨해지면 느슨한 것으로 봅니다 — `good`은 그대로 두고
 * `watch`만 크게 늘리는 방식으로도 빨강을 지울 수 있기 때문입니다.
 */
function isRelaxed(spec: ThresholdSpec, value: KpiThreshold): boolean {
  if (spec.direction === "lower-is-better") {
    return value.good > spec.default.good || value.watch > spec.default.watch;
  }
  return value.good < spec.default.good || value.watch < spec.default.watch;
}

/** 값 하나를 임계값으로 판정한다 (순수 함수) */
export function judgeAgainstThreshold(
  value: number,
  threshold: ResolvedThreshold,
): "good" | "watch" | "bad" {
  if (threshold.direction === "lower-is-better") {
    if (value <= threshold.value.good) {
      return "good";
    }
    return value <= threshold.value.watch ? "watch" : "bad";
  }
  if (value >= threshold.value.good) {
    return "good";
  }
  return value >= threshold.value.watch ? "watch" : "bad";
}

/**
 * 지표 카드에 붙일 임계값 설명 — 기본값이면 `null`.
 *
 * 기본값일 때 아무 말도 안 하는 이유: 모든 카드에 "기본값입니다"가 붙으면
 * 그 문구는 배경이 되고, 정작 조정된 카드의 문구도 배경이 됩니다.
 */
export function describeThreshold(threshold: ResolvedThreshold): string | null {
  if (threshold.isDefault) {
    return null;
  }
  const base = `운영자 조정값 (기본 ${threshold.default.good}/${threshold.default.watch}${threshold.unit} → ${threshold.value.good}/${threshold.value.watch}${threshold.unit})`;
  // 화면에 그대로 실리는 문장이므로 마크다운 강조를 쓰지 않는다 —
  // `**`가 별표로 보이면 문장이 아니라 잡음으로 읽힌다 (TASK-3701에서
  // 같은 실수를 했고, 라이브 스크린샷에서 다시 보였다).
  return threshold.relaxed
    ? `${base} — 기준을 느슨하게 바꾼 것이며, 상태가 좋아진 것이 아닙니다.`
    : `${base} — 기본값보다 엄격합니다.`;
}

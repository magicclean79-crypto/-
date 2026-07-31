/**
 * 운영 기록 보존 정책. (TASK-3901, Sprint 39 — CTO 정책 3901-③)
 *
 * `ops_audit_log`와 `ops_events`는 무기한 쌓입니다. 언젠가는 정리해야
 * 하는데, 정리는 **지우는 일**이라 한 번 잘못 정하면 되돌릴 수 없습니다.
 *
 * ## 감사 기록은 다른 것보다 오래 남아야 합니다
 *
 * 경보는 90일이면 충분합니다 — 지난 분기의 경보를 다시 볼 일은 거의
 * 없습니다. 그런데 감사 기록은 **사고가 난 뒤에 거슬러 올라가는 용도**이고,
 * 사고는 몇 달 뒤에 드러나기도 합니다. "그때 누가 이 설정을 바꿨나"에
 * 답하지 못하는 감사 기록은 없는 것과 같습니다.
 *
 * 그래서 **바닥(floor)** 을 둡니다. 감사 기록을 30일로 줄이는 것은 보존
 * 정책이 아니라 **감사를 끄는 것**이고, 그것은 설정으로 할 일이 아닙니다.
 *
 * ## 지운 것도 남깁니다
 *
 * 정리 작업이 몇 건을 지웠는지 남기지 않으면, 나중에 기록이 없을 때
 * "원래 없었나 지워졌나"를 알 수 없습니다. **없어진 기록은 스스로
 * 말하지 못합니다.**
 */

export const RETENTION_TARGETS = ["ops-audit", "ops-events"] as const;
export type RetentionTarget = (typeof RETENTION_TARGETS)[number];

export interface RetentionSpec {
  target: RetentionTarget;
  title: string;
  /** 기본 보존 일수 */
  defaultDays: number;
  /**
   * **이보다 짧게는 둘 수 없다.** 짧은 보존은 정책이 아니라 기능을 끄는
   * 것이고, 그것은 설정으로 할 일이 아니다.
   */
  minDays: number;
  /** 이보다 길게 두는 것은 막지 않지만 상한은 둔다 (무한은 정책이 아니다) */
  maxDays: number;
  why: string;
}

export const RETENTION_SPECS: RetentionSpec[] = [
  {
    target: "ops-audit",
    title: "운영 감사 기록",
    // 경보(90일)보다 길게 — 사고는 몇 달 뒤에 드러나기도 한다
    defaultDays: 365,
    minDays: 180,
    maxDays: 3650,
    why:
      "감사 기록은 사고가 난 뒤에 거슬러 올라가는 용도입니다. 반년보다 짧게 " +
      "두는 것은 보존 정책이 아니라 감사를 끄는 것입니다.",
  },
  {
    target: "ops-events",
    title: "운영 이벤트",
    defaultDays: 180,
    minDays: 90,
    maxDays: 3650,
    why:
      "이벤트는 활성화가 언제 완료됐고 언제 풀렸는지의 기록입니다. 분기 " +
      "회고에서 다시 보게 되므로 한 분기보다는 길어야 합니다.",
  },
];

const SPEC_BY_TARGET = new Map(RETENTION_SPECS.map((spec) => [spec.target, spec]));

/** 설정 키 — `retention.ops-audit.days` */
export function retentionSettingKey(target: RetentionTarget): string {
  return `retention.${target}.days`;
}

export interface ResolvedRetention {
  target: RetentionTarget;
  title: string;
  days: number;
  defaultDays: number;
  isDefault: boolean;
  minDays: number;
  maxDays: number;
  why: string;
}

export function validateRetention(
  key: string,
  raw: string | null,
): { ok: true } | { ok: false; reason: string } {
  const match = /^retention\.([a-z-]+)\.days$/.exec(key);
  if (match === null) {
    return { ok: false, reason: `보존 정책 키 형식이 아닙니다: ${key}` };
  }
  const spec = SPEC_BY_TARGET.get(match[1] as RetentionTarget);
  if (spec === undefined) {
    return {
      ok: false,
      reason: `보존 정책 대상이 아닙니다: ${match[1]} (${RETENTION_TARGETS.join(" · ")})`,
    };
  }
  if (raw === null) {
    return { ok: true };
  }
  const days = Number(raw);
  if (!Number.isInteger(days)) {
    return { ok: false, reason: `일수는 정수여야 합니다: ${raw}` };
  }
  if (days < spec.minDays) {
    return {
      ok: false,
      reason:
        `${spec.title}의 보존 기간은 ${spec.minDays}일보다 짧게 둘 수 ` +
        `없습니다 (받은 값: ${days}일). ${spec.why}`,
    };
  }
  if (days > spec.maxDays) {
    return {
      ok: false,
      reason: `${spec.title}의 보존 기간 상한은 ${spec.maxDays}일입니다.`,
    };
  }
  return { ok: true };
}

/** 설정에서 보존 정책을 해석한다 (순수 함수) */
export function resolveRetention(settings: Record<string, string>): {
  policies: ResolvedRetention[];
  rejected: { key: string; reason: string }[];
} {
  const rejected: { key: string; reason: string }[] = [];
  const policies = RETENTION_SPECS.map((spec) => {
    const key = retentionSettingKey(spec.target);
    const raw = settings[key];
    let days = spec.defaultDays;
    if (raw !== undefined) {
      const check = validateRetention(key, raw);
      if (check.ok) {
        days = Number(raw);
      } else {
        rejected.push({ key, reason: check.reason });
      }
    }
    return {
      target: spec.target,
      title: spec.title,
      days,
      defaultDays: spec.defaultDays,
      isDefault: days === spec.defaultDays,
      minDays: spec.minDays,
      maxDays: spec.maxDays,
      why: spec.why,
    };
  });
  return { policies, rejected };
}

/** 정리 1회의 결과 */
export interface RetentionSweep {
  target: RetentionTarget;
  title: string;
  days: number;
  /** 지운 건수 — **0도 기록한다**(안 지운 것과 안 돈 것은 다르다) */
  deleted: number;
  /** 이 시각보다 오래된 것을 지웠다 */
  cutoff: string;
}

/**
 * 정리 결과를 사람이 읽는 한 줄로 (순수 함수).
 *
 * **아무것도 안 지웠어도 그 사실을 적습니다** — 기록이 없을 때 "원래
 * 없었나 지워졌나"를 나중에 알 수 있어야 하고, 없어진 기록은 스스로
 * 말하지 못합니다.
 */
export function describeSweep(sweeps: RetentionSweep[]): string {
  if (sweeps.length === 0) {
    return "정리 대상이 없습니다.";
  }
  const total = sweeps.reduce((sum, sweep) => sum + sweep.deleted, 0);
  const parts = sweeps.map(
    (sweep) => `${sweep.title} ${sweep.deleted}건(${sweep.days}일 이전)`,
  );
  return total === 0
    ? `보존 기간을 넘긴 기록이 없습니다 — ${parts.join(" · ")}.`
    : `${total}건을 정리했습니다: ${parts.join(" · ")}.`;
}

/**
 * Scheduled Checks. (TASK-1302, Sprint 13)
 *
 * 예약 점검의 **간격 해석과 실행 판단**만 담당하는 순수 로직 — 타이머는
 * api 어댑터가 돌린다. 여기서 순수하게 두는 이유는 "지금 돌려야 하는가"를
 * 시간을 흉내 내지 않고 테스트할 수 있어야 하기 때문이다.
 *
 * 간격은 `15m`·`1h`·`30s`·밀리초 숫자를 모두 받는다. 사람이 쓰는 값이라
 * 단위 없는 숫자만 받으면 반드시 잘못 적는다.
 */

export const SCHEDULED_JOBS = [
  "cost-verification",
  "provider-validation",
  "health-check",
] as const;

export type ScheduledJob = (typeof SCHEDULED_JOBS)[number];

/** 각 점검의 기본 간격 — 비용이 큰 것일수록 드물게 */
export const DEFAULT_JOB_INTERVALS: Record<ScheduledJob, number> = {
  // 비용 검증: DB 조회만 — 자주 해도 부담이 없다
  "cost-verification": 15 * 60 * 1000,
  // 설정 검증: 환경변수 읽기 — Live Check는 하지 않으므로 과금 없음
  "provider-validation": 15 * 60 * 1000,
  // Health Check: **실제 Provider 호출 = 과금**. 그래서 가장 드물게 돈다
  "health-check": 60 * 60 * 1000,
};

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

/**
 * `15m`·`1h`·`30s`·`900000`을 밀리초로 바꾼다.
 * 해석할 수 없거나 0 이하이면 `fallback`을 쓴다 — 잘못 적은 값 때문에
 * 점검이 멈추거나 폭주하는 것보다 기본값으로 도는 편이 안전하다.
 */
export function parseIntervalMs(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return fallback;
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(trimmed);
  if (!match) {
    return fallback;
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const result = amount * UNIT_MS[unit];
  if (!Number.isFinite(result) || result <= 0) {
    return fallback;
  }
  return Math.round(result);
}

export interface JobSchedule {
  job: ScheduledJob;
  intervalMs: number;
  enabled: boolean;
  /** 값의 출처 (표시용) */
  source: "env" | "default" | "disabled";
  env: string;
}

/** 점검별 간격 환경변수 */
export const JOB_INTERVAL_ENV: Record<ScheduledJob, string> = {
  "cost-verification": "OPS_CHECK_COST_INTERVAL",
  "provider-validation": "OPS_CHECK_CONFIG_INTERVAL",
  "health-check": "OPS_CHECK_HEALTH_INTERVAL",
};

/**
 * 환경에서 예약 점검 구성을 읽는다.
 *
 * `OPS_SCHEDULED_CHECKS=off`면 전부 끈다 — 개발·테스트에서 예약 실행이
 * 돌면 안 되기 때문이다(실제로 Provider를 호출하는 점검이 섞여 있다).
 * 개별 항목은 간격을 `off`/`0`으로 두어 끌 수 있다.
 */
export function resolveSchedules(
  env: Record<string, string | undefined>,
): JobSchedule[] {
  const globallyOff = (env.OPS_SCHEDULED_CHECKS ?? "").trim().toLowerCase();
  const allDisabled = globallyOff === "off" || globallyOff === "false" || globallyOff === "0";

  return SCHEDULED_JOBS.map((job) => {
    const name = JOB_INTERVAL_ENV[job];
    const raw = env[name];
    const rawNormalized = (raw ?? "").trim().toLowerCase();
    const jobOff =
      rawNormalized === "off" || rawNormalized === "false" || rawNormalized === "0";

    if (allDisabled || jobOff) {
      return {
        job,
        intervalMs: DEFAULT_JOB_INTERVALS[job],
        enabled: false,
        source: "disabled" as const,
        env: name,
      };
    }

    return {
      job,
      intervalMs: parseIntervalMs(raw, DEFAULT_JOB_INTERVALS[job]),
      enabled: true,
      source: raw === undefined ? ("default" as const) : ("env" as const),
      env: name,
    };
  });
}

/**
 * 마지막 실행 시각을 보고 지금 돌려야 하는지 판단한다.
 * 한 번도 안 돌았으면 돌린다 — 기동 직후 상태를 모르는 채로 두지 않는다.
 */
export function shouldRun(
  schedule: JobSchedule,
  lastRunAt: number | null,
  now: number,
): boolean {
  if (!schedule.enabled) {
    return false;
  }
  if (lastRunAt === null) {
    return true;
  }
  return now - lastRunAt >= schedule.intervalMs;
}

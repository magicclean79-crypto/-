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
  // 경보 보관 (TASK-1501, CTO 결정 1401-③) — 하루 1회 새벽
  "alert-archive",
  // 운영 검증 (TASK-1601, Sprint 16)
  "backup",
  "restore-verify",
  "provider-smoke",
  // 원격 사본 대조 (TASK-2101, CTO 결정 2001-②) — 주 1회, 운영에서만
  "remote-verify",
  // 발행 위반 예약 스캔 (TASK-2701, CTO 결정 2601-②) — 하루 1회
  "governance-scan",
  // 가격 변경 감지 (TASK-3201, CTO 정책 3201-①) — 기록과 가격표를 대조한다
  "pricing-detect",
  // 월말 비용 예측 경보 (TASK-3201, CTO 정책 3201-④) — 하루 1회, **경보만**
  "cost-forecast",
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
  // 보관은 하루 1회 — 간격이 아니라 **시각**으로 돈다 (아래 DAILY_JOBS)
  "alert-archive": 24 * 60 * 60 * 1000,
  // 백업은 **1시간 간격** (CTO 결정 1701-①) — 하루 1회는 최대 24시간을
  // 잃는다는 뜻이었고, 덤프가 작아 자주 받는 편이 훨씬 싸다
  backup: 60 * 60 * 1000,
  // 복구 검증·스모크는 여전히 시각 기반 (TASK-1601)
  "restore-verify": 24 * 60 * 60 * 1000,
  "provider-smoke": 24 * 60 * 60 * 1000,
  // 원격 대조는 **전송 비용**이 든다 — 주 1회 (CTO 결정 2001-②)
  "remote-verify": 7 * 24 * 60 * 60 * 1000,
  // 위반 스캔은 DB만 읽는다(과금 없음). 다만 콘텐츠 전량을 판정하므로
  // 하루 1회 **시각**으로 돌린다 — 아래 DAILY_JOBS
  "governance-scan": 24 * 60 * 60 * 1000,
  // 가격 감지는 DB만 읽는다. Provider 단가는 자주 바뀌지 않으므로 6시간마다
  // 보면 충분하고, 더 자주 보면 같은 제안을 두고 경보만 반복된다
  "pricing-detect": 6 * 60 * 60 * 1000,
  // 예측은 하루 단위 사안이다 — 시각으로 돌린다 (아래 DAILY_JOBS)
  "cost-forecast": 24 * 60 * 60 * 1000,
};

/**
 * **운영에서만** 도는 점검 (CTO 결정 2001-②).
 *
 * 원격 대조는 저장소에서 실제로 내려받으므로 전송 비용이 든다. 개발·테스트가
 * 이 비용을 내야 할 이유가 없고, 개발 저장소에는 대조할 원격 사본도 없다.
 * 운영이 아닌 곳에서는 `disabled`로 두되, **환경변수로 명시하면 켤 수 있다** —
 * 스테이징에서 한 번 돌려 보는 길까지 막을 이유는 없다.
 */
export const PRODUCTION_ONLY_JOBS: ScheduledJob[] = ["remote-verify"];

/**
 * 손실 한도(RPO) 기본 목표는 **백업 간격의 2배** (TASK-1801).
 *
 * 한 번 걸러 실패해도 목표를 지킨다는 뜻이다. 간격을 바꿨는데 목표가 24시간에
 * 그대로 묶여 있으면, 백업이 20시간 멈춰도 "정상"으로 보인다 — 설정과 판정이
 * 어긋나면 화면이 거짓이 된다.
 */
export function defaultRpoTargetMs(backupIntervalMs: number): number {
  return backupIntervalMs * 2;
}

/**
 * 기본이 **꺼짐**인 점검 (TASK-1601).
 *
 * 실 Provider를 호출해 **과금되는** 스모크는 운영자가 명시적으로 켜야 한다 —
 * 켜져 있는 줄 모르고 돈이 나가는 상황을 만들지 않는다.
 */
export const DEFAULT_DISABLED_JOBS: ScheduledJob[] = ["provider-smoke"];

/**
 * 시각 기반으로 도는 점검 (CTO 결정 1401-③).
 *
 * 간격이 아니라 "하루 한 번, 정해진 시각"이다 — 보관은 트래픽이 적은 때
 * 도는 편이 낫고, 간격 기반이면 재기동할 때마다 시점이 밀린다.
 */
export const DAILY_JOBS: Partial<Record<ScheduledJob, string>> = {
  "alert-archive": "OPS_CHECK_ARCHIVE_AT",
  "restore-verify": "OPS_CHECK_RESTORE_AT",
  "provider-smoke": "OPS_CHECK_SMOKE_AT",
  // 위반 스캔 (TASK-2701) — 보관 정리보다 앞에 둔다: 스캔이 남긴 결과를
  // 보관이 곧바로 치우면 방금 만든 기록을 못 보게 된다
  "governance-scan": "OPS_CHECK_GOVERNANCE_SCAN_AT",
  // 비용 예측 (TASK-3201) — 하루가 끝난 뒤 봐야 관측 일수가 채워진다
  "cost-forecast": "OPS_CHECK_FORECAST_AT",
};

/** 점검별 기본 실행 시각 — 서로 겹치지 않게 둔다 (백업 → 복구 검증 → 보관) */
export const DEFAULT_DAILY_TIMES: Partial<Record<ScheduledJob, string>> = {
  "restore-verify": "03:30",
  // 예측은 밤에 쌓인 하루가 집계된 뒤 본다
  "cost-forecast": "06:00",
  "governance-scan": "03:50",
  "alert-archive": "04:00",
  "provider-smoke": "05:00",
};

/**
 * 기본 실행 시각 — **운영 서버의 로컬 시간대** 기준 (CTO 결정 1501-①).
 *
 * 예산 창 등 다른 시간 계산은 UTC지만, 보관은 "트래픽이 적은 새벽"을 노리는
 * 작업이라 사람이 사는 시간대를 따라야 한다. 시간대는 `TZ` 환경변수를 따른다.
 */
export const DEFAULT_DAILY_AT = "04:00";

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  // 주 1회 대조(CTO 결정 2001-②)를 `168h`로 적게 만들 이유가 없다
  d: 24 * 60 * 60 * 1000,
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
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(trimmed);
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
  /** 시각 기반 점검이면 자정 이후 분 (**운영 서버 로컬 시각**) — 간격 기반이면 null */
  dailyAtMinutes: number | null;
}

/** 점검별 간격 환경변수 */
export const JOB_INTERVAL_ENV: Record<ScheduledJob, string> = {
  "cost-verification": "OPS_CHECK_COST_INTERVAL",
  "provider-validation": "OPS_CHECK_CONFIG_INTERVAL",
  "health-check": "OPS_CHECK_HEALTH_INTERVAL",
  "alert-archive": "OPS_CHECK_ARCHIVE_AT",
  // 시각(HH:MM)에서 간격으로 바뀌었다 (CTO 결정 1701-①) — 구 이름은
  // env-spec이 "더 이상 쓰이지 않는다"고 경고한다
  backup: "OPS_CHECK_BACKUP_INTERVAL",
  "restore-verify": "OPS_CHECK_RESTORE_AT",
  "provider-smoke": "OPS_CHECK_SMOKE_AT",
  "remote-verify": "OPS_CHECK_REMOTE_VERIFY_INTERVAL",
  "governance-scan": "OPS_CHECK_GOVERNANCE_SCAN_AT",
  "pricing-detect": "OPS_CHECK_PRICING_DETECT_INTERVAL",
  "cost-forecast": "OPS_CHECK_FORECAST_AT",
};

/**
 * `HH:MM`을 자정 이후 분으로 바꾼다. 해석할 수 없으면 null —
 * 호출부가 기본값으로 되돌린다(잘못 적은 값으로 엉뚱한 시각에 돌지 않게).
 */
export function parseDailyAt(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

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
  const production = (env.NODE_ENV ?? "").trim().toLowerCase() === "production";

  return SCHEDULED_JOBS.map((job) => {
    const name = JOB_INTERVAL_ENV[job];
    const raw = env[name];
    const rawNormalized = (raw ?? "").trim().toLowerCase();
    const jobOff =
      rawNormalized === "off" || rawNormalized === "false" || rawNormalized === "0";

    const daily = DAILY_JOBS[job] !== undefined;
    const defaultAt = DEFAULT_DAILY_TIMES[job] ?? DEFAULT_DAILY_AT;
    // 과금되는 점검은 명시적으로 켜야 한다 (TASK-1601)
    // 운영 전용 점검은 운영이 아니면 꺼진다 — 다만 명시하면 켤 수 있다
    const defaultOff =
      raw === undefined &&
      (DEFAULT_DISABLED_JOBS.includes(job) ||
        (PRODUCTION_ONLY_JOBS.includes(job) && !production));

    if (allDisabled || jobOff || defaultOff) {
      return {
        job,
        intervalMs: DEFAULT_JOB_INTERVALS[job],
        enabled: false,
        source: "disabled" as const,
        env: name,
        dailyAtMinutes: daily ? parseDailyAt(defaultAt) : null,
      };
    }

    if (daily) {
      // 해석할 수 없는 시각은 기본값으로 — 엉뚱한 시각에 돌지 않게
      const minutes = parseDailyAt(raw) ?? parseDailyAt(defaultAt)!;
      return {
        job,
        intervalMs: DEFAULT_JOB_INTERVALS[job],
        enabled: true,
        source: raw === undefined ? ("default" as const) : ("env" as const),
        env: name,
        dailyAtMinutes: minutes,
      };
    }

    return {
      job,
      intervalMs: parseIntervalMs(raw, DEFAULT_JOB_INTERVALS[job]),
      enabled: true,
      source: raw === undefined ? ("default" as const) : ("env" as const),
      env: name,
      dailyAtMinutes: null,
    };
  });
}

/**
 * 마지막 실행 시각을 보고 지금 돌려야 하는지 판단한다.
 *
 * - 간격 기반: 마지막 실행 이후 간격이 지났으면 실행
 * - 시각 기반(하루 1회): 오늘의 그 시각을 지났고, 그 시각 이후로 아직 안
 *   돌았으면 실행. **한 번도 안 돌았어도 시각 전이면 돌지 않는다** —
 *   "새벽에 돌리라"는 지시를 기동 시점에 어기지 않기 위해서다.
 */
export function shouldRun(
  schedule: JobSchedule,
  lastRunAt: number | null,
  now: number,
): boolean {
  if (!schedule.enabled) {
    return false;
  }

  if (schedule.dailyAtMinutes !== null) {
    // 로컬 시간대 기준 자정 (CTO 결정 1501-① — TZ 환경변수를 따른다)
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const dueAt = midnight.getTime() + schedule.dailyAtMinutes * 60_000;
    if (now < dueAt) {
      return false;
    }
    return lastRunAt === null || lastRunAt < dueAt;
  }

  if (lastRunAt === null) {
    return true;
  }
  return now - lastRunAt >= schedule.intervalMs;
}

/**
 * 예약 점검이 **멈춘** 것으로 볼 것인가 (TASK-1501, CTO 결정 1401-①).
 *
 * Redis 장애로 잠금을 못 잡으면 예약 점검이 아예 돌지 않는다. 단일 모드로
 * 자동 폴백하지 않기로 했으므로(중복 실행보다 안전하다), 대신 **멈춘 사실을
 * 알린다** — 조용히 안 도는 점검이 가장 위험하다.
 *
 * 판정은 관대하게 한다: 간격의 `graceFactor`배(기본 3)를 넘겨야 멈춘 것으로
 * 본다. 한 번 늦었다고 경보하면 사람이 경보를 무시하게 된다.
 */
export function isSchedulerStopped(
  schedule: JobSchedule,
  lastRunAt: number | null,
  now: number,
  options: { graceFactor?: number; startedAt?: number } = {},
): boolean {
  if (!schedule.enabled) {
    return false; // 꺼 둔 것은 멈춘 것이 아니다
  }
  const grace = options.graceFactor ?? 3;
  const window =
    schedule.dailyAtMinutes !== null
      ? DEFAULT_JOB_INTERVALS[schedule.job] * grace
      : schedule.intervalMs * grace;

  // 한 번도 안 돌았으면 기동 시점부터 센다 — 방금 뜬 서버를 장애라 하지 않는다
  const reference = lastRunAt ?? options.startedAt ?? now;
  return now - reference > window;
}

/**
 * Job별 정지 판정 여유 배수 (CTO 결정 1501-④).
 *
 * 기본 3배를 유지하되 Job마다 조정할 수 있다 — 주기가 긴 점검(보관은 하루)은
 * 3배면 사흘이라 감지가 너무 늦고, 짧은 점검은 3배로도 충분하다.
 * `OPS_SCHEDULER_GRACE_<JOB>` (예: `OPS_SCHEDULER_GRACE_COST_VERIFICATION`).
 */
export const DEFAULT_GRACE_FACTOR = 3;

export function graceFactorEnv(job: ScheduledJob): string {
  return `OPS_SCHEDULER_GRACE_${job.toUpperCase().replace(/-/g, "_")}`;
}

export function resolveGraceFactor(
  job: ScheduledJob,
  env: Record<string, string | undefined>,
): number {
  const parse = (value: string | undefined): number | null => {
    if (value === undefined || value.trim().length === 0) {
      return null;
    }
    const parsed = Number(value);
    // 잘못 적은 값 때문에 판정이 무너지는 것보다 기본값이 안전하다
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  return (
    parse(env[graceFactorEnv(job)]) ??
    parse(env.OPS_SCHEDULER_GRACE_FACTOR) ??
    DEFAULT_GRACE_FACTOR
  );
}

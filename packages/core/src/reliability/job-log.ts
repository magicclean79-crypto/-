/**
 * 작업 로그. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * 지금 이 저장소의 로그는 NestJS `Logger`의 자유 문장입니다. 사람이 읽기엔
 * 좋지만 **묶어서 볼 수 없습니다** — "이 작업이 어디까지 갔고 어디서
 * 죽었는가"에 답하려면 시각을 손으로 맞춰 봐야 합니다.
 *
 * TASK-3601이 요청 단위 추적(`requestId`·`traceId`)을 만들었습니다. 그런데
 * **오래 도는 작업은 요청보다 깁니다** — 요청은 끝났는데 작업은 계속됩니다.
 * 그래서 작업 자체의 끈(`jobId`)이 따로 필요합니다.
 *
 * ## 비밀을 로그에 적지 않습니다
 *
 * 로그는 가장 많이 복사되는 텍스트입니다 — 이슈에, 채팅에, 화면 캡처에.
 * 그래서 **적기 전에 가립니다.** 가리는 쪽이 안전한 실수이고, 안 가리는
 * 쪽은 되돌릴 수 없는 실수입니다.
 */

/** 로그 등급 — 넷뿐입니다. 더 두면 아무도 기준을 못 지킵니다. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 무엇을 남기는가 */
export interface JobLogRecord {
  level: LogLevel;
  /** 이 작업의 끈 */
  jobId: string;
  /** 어느 단계에서 */
  stage: string;
  message: string;
  /** 기계가 읽는 값 — 비밀은 가려져 들어온다 */
  data: Record<string, unknown>;
  at: string;
}

/**
 * 이 등급을 지금 남길 것인가.
 *
 * 기본값은 `info`입니다. `debug`를 기본으로 두면 로그가 너무 커져서
 * **정작 필요한 날 찾을 수 없습니다.**
 */
export function shouldLog(level: LogLevel, minimum: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minimum];
}

/** `LOG_LEVEL` 환경변수 — 알 수 없는 값은 기본값으로 되돌리되 말한다 */
export function resolveLogLevel(env: Record<string, string | undefined>): {
  level: LogLevel;
  rejected: string | null;
} {
  const raw = env.LOG_LEVEL?.trim().toLowerCase();
  if (!raw) {
    return { level: "info", rejected: null };
  }
  if ((LOG_LEVELS as readonly string[]).includes(raw)) {
    return { level: raw as LogLevel, rejected: null };
  }
  return { level: "info", rejected: raw };
}

/**
 * 가려야 하는 이름.
 *
 * **이름으로 가립니다.** 값의 모양으로 가리려 하면(예: 긴 무작위 문자열)
 * 새 Provider가 다른 모양의 키를 쓰는 날 조용히 새어 나갑니다.
 */
const SECRET_HINTS = [
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "authorization",
  "cookie",
  "webhook",
  "dsn",
  "connectionstring",
  "url", // 주소에는 자격 증명이 붙어 있는 경우가 흔합니다
];

export const REDACTED = "[가림]";

/**
 * 로그에 실을 값에서 비밀을 가린다 (순수 함수).
 *
 * 중첩된 객체·배열도 따라 들어갑니다. 깊이 상한을 두는 이유는 순환 참조가
 * 있는 값이 들어오면 **로그를 남기다가 죽기** 때문입니다 — 로그가 서비스를
 * 죽이면 안 됩니다.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[너무 깊음]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSecretName(key) ? REDACTED : redact(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.length > 2000 ? `${value.slice(0, 2000)}…[잘림]` : value;
  }
  return value;
}

export function isSecretName(name: string): boolean {
  const lower = name.toLowerCase().replace(/[_-]/g, "");
  return SECRET_HINTS.some((hint) => lower.includes(hint));
}

/**
 * 로그 한 줄을 만든다 (순수 함수).
 *
 * 만드는 것과 내보내는 것을 가릅니다 — 만드는 쪽이 순수해야 **무엇을
 * 남기는지** 테스트할 수 있습니다.
 */
export function buildLogRecord(input: {
  level: LogLevel;
  jobId: string;
  stage: string;
  message: string;
  data?: Record<string, unknown>;
  now: number;
}): JobLogRecord {
  return {
    level: input.level,
    jobId: input.jobId,
    stage: input.stage,
    message: input.message,
    data: (redact(input.data ?? {}) as Record<string, unknown>) ?? {},
    at: new Date(input.now).toISOString(),
  };
}

/**
 * 한 줄 텍스트 — 사람이 터미널에서 읽는 모양.
 *
 * **작업 id를 맨 앞에** 둡니다. 뒤에 두면 줄이 길어졌을 때 잘려서, 정작
 * 묶어 보려고 만든 값이 안 보입니다.
 */
export function formatLogLine(record: JobLogRecord): string {
  const data =
    Object.keys(record.data).length === 0 ? "" : ` ${JSON.stringify(record.data)}`;
  return `[${record.jobId}] [${record.stage}] ${record.message}${data}`;
}

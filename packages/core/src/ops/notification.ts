/**
 * Notification Center. (TASK-1401, Sprint 14)
 *
 * 경보를 **어느 채널로, 어떤 모양으로, 실패하면 언제 다시** 보낼지 정하는
 * 순수 로직. 실제 전송(HTTP·SMTP)은 api 어댑터가 한다.
 *
 * TASK-1302의 웹훅은 단일 URL·재시도 없음이었다. 알림이 한 번 실패하면
 * **아무도 모르는 채로 끝난다** — 그게 이 TASK가 고치는 문제다.
 *
 * 설계 원칙:
 * - **재시도는 유한하다.** 무한 재시도는 죽은 채널에 영원히 매달린다.
 * - **되돌릴 수 없는 실패는 재시도하지 않는다** (4xx — 잘못된 URL·인증 실패).
 *   같은 요청을 다시 보내도 같은 답이 온다.
 * - **채널 하나가 죽어도 나머지는 보낸다.** 슬랙이 죽었다고 메일까지 막히면
 *   알림 체계 전체가 단일 장애점이 된다.
 * - 심각도로 채널을 고를 수 있다 — 모든 warning을 밤중에 슬랙으로 받으면
 *   사람이 알림을 끈다.
 */

export const NOTIFICATION_CHANNELS = ["slack", "email", "webhook"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationLevel = "warning" | "critical" | "resolved";

/** 보낼 내용 — 채널과 무관한 표현 */
export interface NotificationPayload {
  level: NotificationLevel;
  kind: string;
  key: string;
  title: string;
  message: string;
  /** 발생 시각 (ISO) */
  at: string;
  environment: string;
  /** 경보를 볼 수 있는 화면 주소 (있으면) */
  url: string | null;
}

export interface ChannelConfig {
  channel: NotificationChannel;
  enabled: boolean;
  /** 이 채널이 받을 최소 심각도 — `warning`이면 전부, `critical`이면 심각만 */
  minLevel: "warning" | "critical";
  /** 해소 알림도 받을지 */
  resolved: boolean;
}

/**
 * 이 알림을 이 채널로 보낼 것인가.
 *
 * 해소(`resolved`)는 심각도 비교 대상이 아니다 — 별도 스위치로 다룬다.
 * "critical만 받겠다"는 사람도 해소는 받고 싶을 수 있고, 그 반대도 있다.
 */
export function shouldNotify(
  config: ChannelConfig,
  level: NotificationLevel,
): boolean {
  if (!config.enabled) {
    return false;
  }
  if (level === "resolved") {
    return config.resolved;
  }
  if (config.minLevel === "critical") {
    return level === "critical";
  }
  return true;
}

/** 보낼 채널 목록 */
export function selectChannels(
  configs: ChannelConfig[],
  level: NotificationLevel,
): NotificationChannel[] {
  return configs
    .filter((config) => shouldNotify(config, level))
    .map((config) => config.channel);
}

// ── 재시도 ───────────────────────────────────────────────────

export interface RetryPolicy {
  /** 최초 시도를 포함한 최대 시도 횟수 */
  maxAttempts: number;
  /** 첫 재시도까지의 대기 (ms) — 이후 2배씩 */
  baseDelayMs: number;
  /** 대기 상한 (ms) */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

/**
 * 재시도해도 결과가 달라질 수 있는 실패인가.
 *
 * - 네트워크 오류(status 없음) → 재시도
 * - 5xx·429 → 재시도 (일시적)
 * - 그 외 4xx → **재시도하지 않는다** — 잘못된 URL·인증 실패는 같은 요청을
 *   다시 보내도 같은 답이 온다. 매달려 있어 봐야 로그만 늘어난다.
 */
export function isRetriable(status: number | null): boolean {
  if (status === null) {
    return true;
  }
  if (status === 429) {
    return true;
  }
  return status >= 500;
}

/** n번째 재시도까지의 대기 (attempt는 1부터 — 1이면 첫 재시도) */
export function retryDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  if (attempt < 1) {
    return 0;
  }
  const delay = policy.baseDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, policy.maxDelayMs);
}

export interface RetryDecision {
  retry: boolean;
  /** 다음 시도까지 대기 (ms) — retry가 false면 0 */
  delayMs: number;
  reason: string;
}

/** 전송 실패 후 다시 시도할지 */
export function decideRetry(
  attempt: number,
  status: number | null,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): RetryDecision {
  if (!isRetriable(status)) {
    return {
      retry: false,
      delayMs: 0,
      reason: `HTTP ${status} — 다시 보내도 같은 결과입니다 (설정을 고쳐야 합니다).`,
    };
  }
  if (attempt >= policy.maxAttempts) {
    return {
      retry: false,
      delayMs: 0,
      reason: `${policy.maxAttempts}회 시도 후 포기했습니다 — 채널 상태를 확인하세요.`,
    };
  }
  return {
    retry: true,
    delayMs: retryDelayMs(attempt, policy),
    reason: status === null ? "네트워크 오류 — 재시도합니다." : `HTTP ${status} — 재시도합니다.`,
  };
}

// ── 채널별 본문 ──────────────────────────────────────────────

const LEVEL_EMOJI: Record<NotificationLevel, string> = {
  warning: "⚠️",
  critical: "🚨",
  resolved: "✅",
};

const LEVEL_LABEL: Record<NotificationLevel, string> = {
  warning: "주의",
  critical: "심각",
  resolved: "해소",
};

/** Slack incoming webhook 본문 (blocks 없이 text만 — 어떤 워크스페이스에서도 뜬다) */
export function slackBody(payload: NotificationPayload): {
  text: string;
} {
  const lines = [
    `${LEVEL_EMOJI[payload.level]} *[${LEVEL_LABEL[payload.level]}] ${payload.title}*`,
    payload.message,
    `환경: ${payload.environment} · 종류: ${payload.kind} · ${payload.at}`,
  ];
  if (payload.url) {
    lines.push(payload.url);
  }
  return { text: lines.join("\n") };
}

/** 메일 제목·본문 — 제목만 봐도 조치 여부를 판단할 수 있어야 한다 */
export function emailBody(payload: NotificationPayload): {
  subject: string;
  text: string;
} {
  const subject = `[ACOS/${payload.environment}] ${LEVEL_LABEL[payload.level]} — ${payload.title}`;
  const text = [
    payload.message,
    "",
    `종류: ${payload.kind}`,
    `키: ${payload.key}`,
    `시각: ${payload.at}`,
    `환경: ${payload.environment}`,
    ...(payload.url ? ["", payload.url] : []),
  ].join("\n");
  return { subject, text };
}

/** 범용 웹훅 본문 — 기계가 읽는다 (TASK-1302 계약 유지) */
export function webhookBody(payload: NotificationPayload): Record<string, unknown> {
  return {
    service: "ai-product-content-os",
    environment: payload.environment,
    level: payload.level,
    kind: payload.kind,
    key: payload.key,
    title: payload.title,
    message: payload.message,
    at: payload.at,
    url: payload.url,
  };
}

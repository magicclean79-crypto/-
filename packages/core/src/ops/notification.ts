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

/**
 * 보낼 수 있는 채널 (TASK-4501에서 `teams` 추가 — CTO 정책 4501-③).
 *
 * **채널을 더할 때 빠뜨리기 쉬운 것이 넷 있습니다**: 기본 정책 ·
 * 설정 환경변수 · 긴급 경로 환경변수 · 본문 형식. 넷 중 하나만 빠져도
 * 그 채널은 **조용히 안 갑니다** — 설정한 사람은 보냈다고 믿고 있고요.
 * 사람의 기억에 기대는 규칙은 반드시 어긋나므로, `notification.spec.ts`가
 * 이 목록을 돌며 넷이 다 있는지 검사합니다.
 */
export const NOTIFICATION_CHANNELS = ["slack", "email", "webhook", "teams"] as const;
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

/**
 * Teams 카드 색 (TASK-4501).
 *
 * **색은 글자를 대신하지 않습니다** — 카드에는 심각도를 글자로도 적습니다.
 * 색만 쓰면 색을 구분하지 못하는 사람에게는 아무 정보도 아닙니다.
 */
const LEVEL_COLOR: Record<NotificationLevel, string> = {
  warning: "F2C744",
  critical: "D64545",
  resolved: "3AA76D",
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

/**
 * Microsoft Teams incoming webhook 본문 (TASK-4501, CTO 정책 4501-③).
 *
 * Teams는 평문을 받지 않고 **MessageCard** 형식을 요구합니다. 그래서 같은
 * 알림이라도 모양을 따로 만들어야 합니다 — 그런데 **내용이 달라지면 안
 * 됩니다.** 채널마다 다른 사실이 보이면, 두 채널을 다 보는 사람이 둘 다
 * 못 믿게 됩니다.
 *
 * `themeColor`로 심각도를 색으로도 보여 주되, **글자로도 남깁니다** — 색만
 * 쓰면 색을 구분하지 못하는 사람에게는 아무 정보도 아닙니다.
 */
export function teamsBody(payload: NotificationPayload): Record<string, unknown> {
  const facts = [
    { name: "심각도", value: LEVEL_LABEL[payload.level] },
    { name: "종류", value: payload.kind },
    { name: "키", value: payload.key },
    { name: "환경", value: payload.environment },
    { name: "시각", value: payload.at },
  ];
  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: LEVEL_COLOR[payload.level],
    summary: `[${LEVEL_LABEL[payload.level]}] ${payload.title}`,
    title: `${LEVEL_EMOJI[payload.level]} [${LEVEL_LABEL[payload.level]}] ${payload.title}`,
    text: payload.message,
    sections: [{ facts }],
    ...(payload.url === null
      ? {}
      : {
          potentialAction: [
            {
              "@type": "OpenUri",
              name: "화면에서 보기",
              targets: [{ os: "default", uri: payload.url }],
            },
          ],
        }),
  };
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

// ── 운영 기본 채널 정책 (CTO 결정 1401-④) ────────────────────

/**
 * 공식 기본값: Slack은 Warning 이상, **Email은 Critical 이상**, Webhook은
 * Warning 이상, 해소 알림은 전부 포함.
 *
 * 메일만 Critical인 이유는 분명하다 — 메일은 지우기 번거롭고 쌓이면 읽지
 * 않게 된다. 채널마다 "얼마나 시끄러워도 되는가"가 다르다.
 * 환경변수로 전부 바꿀 수 있다.
 */
export const DEFAULT_CHANNEL_POLICY: Record<
  NotificationChannel,
  { minLevel: "warning" | "critical"; resolved: boolean }
> = {
  slack: { minLevel: "warning", resolved: true },
  email: { minLevel: "critical", resolved: true },
  webhook: { minLevel: "warning", resolved: true },
  // Teams는 Slack과 같은 자리(팀 채널)이므로 같은 기본값으로 둡니다 —
  // 다르게 두면 "왜 슬랙에는 왔는데 팀즈에는 안 왔지"가 생깁니다
  teams: { minLevel: "warning", resolved: true },
};

/** 채널별 설정 환경변수 이름 */
export const CHANNEL_ENV: Record<
  NotificationChannel,
  { minLevel: string; resolved: string; target: string }
> = {
  slack: {
    minLevel: "ALERT_SLACK_MIN_LEVEL",
    resolved: "ALERT_SLACK_RESOLVED",
    target: "ALERT_SLACK_WEBHOOK_URL",
  },
  email: {
    minLevel: "ALERT_EMAIL_MIN_LEVEL",
    resolved: "ALERT_EMAIL_RESOLVED",
    target: "SMTP_HOST + ALERT_EMAIL_TO",
  },
  webhook: {
    minLevel: "ALERT_WEBHOOK_MIN_LEVEL",
    resolved: "ALERT_WEBHOOK_RESOLVED",
    target: "ALERT_WEBHOOK_URL",
  },
  teams: {
    minLevel: "ALERT_TEAMS_MIN_LEVEL",
    resolved: "ALERT_TEAMS_RESOLVED",
    target: "ALERT_TEAMS_WEBHOOK_URL",
  },
};

function boolFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "") {
    return fallback;
  }
  return !["0", "off", "false", "no"].includes(normalized);
}

/**
 * 환경에서 채널 정책을 읽는다. 값이 없으면 **결정 1401-④의 공식 기본값**.
 * 활성 여부는 주소가 설정되었는지로 판단하므로 호출부가 넘긴다.
 */
export function resolveChannelPolicy(
  env: Record<string, string | undefined>,
  enabled: Record<NotificationChannel, boolean>,
): ChannelConfig[] {
  return NOTIFICATION_CHANNELS.map((channel) => {
    const spec = CHANNEL_ENV[channel];
    const raw = (env[spec.minLevel] ?? "").trim().toLowerCase();
    return {
      channel,
      enabled: enabled[channel],
      minLevel:
        raw === "critical"
          ? ("critical" as const)
          : raw === "warning"
            ? ("warning" as const)
            : DEFAULT_CHANNEL_POLICY[channel].minLevel,
      resolved: boolFlag(
        env[spec.resolved],
        DEFAULT_CHANNEL_POLICY[channel].resolved,
      ),
    };
  });
}

// ── Persistent Notification Queue (CTO 결정 1401-②) ──────────

export type QueueStatus = "PENDING" | "SENT" | "DEAD" | "ARCHIVED";

/** 큐에 담긴 전송 1건의 상태 (판정 입력) */
export interface QueueItemState {
  id: string;
  channel: NotificationChannel;
  attempts: number;
  status: QueueStatus;
  nextAttemptAt: number;
}

export type QueueOutcome = "sent" | "retry" | "dead";

export interface QueueDecision {
  outcome: QueueOutcome;
  /** retry일 때 다음 시도 시각 (epoch ms) */
  nextAttemptAt: number;
  reason: string;
}

/**
 * 전송 결과를 큐 항목의 다음 상태로 바꾼다.
 *
 * **Dead Letter Queue**로 보내는 경우는 둘이다:
 * - 되돌릴 수 없는 실패(4xx) — 다시 보내도 같은 답이 온다
 * - 최대 시도 소진 — 죽은 채널에 영원히 매달리지 않는다
 *
 * DLQ 항목은 **지우지 않는다**. 무엇이 전달되지 못했는지 남아 있어야
 * 사람이 고친 뒤 다시 보낼 수 있다.
 */
export function decideQueueOutcome(
  attempt: number,
  result: { ok: boolean; status: number | null },
  now: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): QueueDecision {
  if (result.ok) {
    return { outcome: "sent", nextAttemptAt: now, reason: "전송 성공" };
  }
  const decision = decideRetry(attempt, result.status, policy);
  if (!decision.retry) {
    return { outcome: "dead", nextAttemptAt: now, reason: decision.reason };
  }
  return {
    outcome: "retry",
    nextAttemptAt: now + decision.delayMs,
    reason: decision.reason,
  };
}

/** 지금 보낼 수 있는 항목인가 (Retry Worker가 집어 갈 대상) */
export function isDue(item: QueueItemState, now: number): boolean {
  return item.status === "PENDING" && item.nextAttemptAt <= now;
}

export interface QueueSummary {
  pending: number;
  sent: number;
  /** Dead Letter — 사람이 고쳐야 나간다 */
  dead: number;
  /** 90일이 지나 보관된 Dead Letter (CTO 결정 1501-③ — 삭제 아님) */
  archived: number;
  /** 지금 보낼 수 있는 항목 수 */
  due: number;
}

export function summarizeQueue(
  items: QueueItemState[],
  now: number,
): QueueSummary {
  return {
    pending: items.filter((item) => item.status === "PENDING").length,
    sent: items.filter((item) => item.status === "SENT").length,
    dead: items.filter((item) => item.status === "DEAD").length,
    archived: items.filter((item) => item.status === "ARCHIVED").length,
    due: items.filter((item) => isDue(item, now)).length,
  };
}

import {
  DEFAULT_CHANNEL_POLICY,
  decideQueueOutcome,
  decideRetry,
  DEFAULT_RETRY_POLICY,
  emailBody,
  isRetriable,
  retryDelayMs,
  isDue,
  resolveChannelPolicy,
  selectChannels,
  shouldNotify,
  summarizeQueue,
  slackBody,
  webhookBody,
} from "./notification";
import type {
  ChannelConfig,
  NotificationPayload,
  QueueItemState,
} from "./notification";

function channel(overrides: Partial<ChannelConfig> = {}): ChannelConfig {
  return {
    channel: overrides.channel ?? "slack",
    enabled: overrides.enabled ?? true,
    minLevel: overrides.minLevel ?? "warning",
    resolved: overrides.resolved ?? true,
  };
}

const PAYLOAD: NotificationPayload = {
  level: "critical",
  kind: "budget",
  key: "budget:daily",
  title: "일 예산 초과",
  message: "일 지출 $12 / 예산 $10 (120%)",
  at: "2026-07-29T00:00:00.000Z",
  environment: "production",
  url: "https://acos.example.com/admin/production",
};

describe("Notification Center (TASK-1401)", () => {
  describe("shouldNotify", () => {
    it("꺼진 채널은 아무것도 받지 않는다", () => {
      expect(shouldNotify(channel({ enabled: false }), "critical")).toBe(false);
    });

    it("minLevel=critical이면 warning은 거른다 — 밤중 알림을 다 받으면 사람이 끈다", () => {
      const strict = channel({ minLevel: "critical" });
      expect(shouldNotify(strict, "critical")).toBe(true);
      expect(shouldNotify(strict, "warning")).toBe(false);
    });

    it("해소는 심각도와 무관하게 별도 스위치로 다룬다", () => {
      // critical만 받는 채널도 해소는 받고 싶을 수 있다
      expect(
        shouldNotify(channel({ minLevel: "critical", resolved: true }), "resolved"),
      ).toBe(true);
      expect(
        shouldNotify(channel({ minLevel: "warning", resolved: false }), "resolved"),
      ).toBe(false);
    });
  });

  describe("selectChannels", () => {
    it("조건을 만족하는 채널만 고른다", () => {
      const configs = [
        channel({ channel: "slack", minLevel: "warning" }),
        channel({ channel: "email", minLevel: "critical" }),
        channel({ channel: "webhook", enabled: false }),
      ];
      expect(selectChannels(configs, "critical")).toEqual(["slack", "email"]);
      expect(selectChannels(configs, "warning")).toEqual(["slack"]);
    });
  });

  describe("isRetriable", () => {
    it("네트워크 오류·5xx·429는 재시도", () => {
      expect(isRetriable(null)).toBe(true);
      expect(isRetriable(500)).toBe(true);
      expect(isRetriable(503)).toBe(true);
      expect(isRetriable(429)).toBe(true);
    });

    it("그 외 4xx는 재시도하지 않는다 — 같은 요청은 같은 답을 받는다", () => {
      expect(isRetriable(400)).toBe(false);
      expect(isRetriable(401)).toBe(false);
      expect(isRetriable(404)).toBe(false);
    });
  });

  describe("retryDelayMs", () => {
    it("지수 백오프이되 상한을 넘지 않는다", () => {
      expect(retryDelayMs(1)).toBe(1_000);
      expect(retryDelayMs(2)).toBe(2_000);
      expect(retryDelayMs(3)).toBe(4_000);
      expect(retryDelayMs(10)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
      expect(retryDelayMs(0)).toBe(0);
    });
  });

  describe("decideRetry", () => {
    it("일시적 실패는 대기 후 재시도", () => {
      expect(decideRetry(1, 503)).toMatchObject({ retry: true, delayMs: 1_000 });
      expect(decideRetry(2, null)).toMatchObject({ retry: true, delayMs: 2_000 });
    });

    it("되돌릴 수 없는 실패는 즉시 포기하고 이유를 말한다", () => {
      const decision = decideRetry(1, 401);
      expect(decision.retry).toBe(false);
      expect(decision.reason).toContain("설정을 고쳐야");
    });

    it("최대 시도 횟수에 닿으면 포기한다 — 죽은 채널에 영원히 매달리지 않는다", () => {
      const decision = decideRetry(DEFAULT_RETRY_POLICY.maxAttempts, 500);
      expect(decision).toMatchObject({ retry: false, delayMs: 0 });
      expect(decision.reason).toContain("포기");
    });

    it("정책을 바꿔 넘길 수 있다", () => {
      expect(
        decideRetry(1, 500, { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 10 })
          .retry,
      ).toBe(false);
    });
  });

  describe("채널별 본문", () => {
    it("Slack — 심각도가 한눈에 보이고 링크가 붙는다", () => {
      const body = slackBody(PAYLOAD);
      expect(body.text).toContain("🚨");
      expect(body.text).toContain("[심각] 일 예산 초과");
      expect(body.text).toContain("production");
      expect(body.text).toContain("https://acos.example.com/admin/production");
    });

    it("Slack — 링크가 없으면 붙이지 않는다", () => {
      expect(slackBody({ ...PAYLOAD, url: null }).text).not.toContain("http");
    });

    it("Email — 제목만 봐도 환경·심각도·내용을 안다", () => {
      const body = emailBody(PAYLOAD);
      expect(body.subject).toBe("[ACOS/production] 심각 — 일 예산 초과");
      expect(body.text).toContain("budget:daily");
      expect(body.text).toContain("2026-07-29T00:00:00.000Z");
    });

    it("Email — 해소는 해소로 표시된다", () => {
      expect(emailBody({ ...PAYLOAD, level: "resolved" }).subject).toContain(
        "해소",
      );
    });

    it("Webhook — 기계가 읽는 구조 (TASK-1302 계약 유지)", () => {
      expect(webhookBody(PAYLOAD)).toMatchObject({
        service: "ai-product-content-os",
        environment: "production",
        level: "critical",
        kind: "budget",
        key: "budget:daily",
      });
    });
  });

  describe("resolveChannelPolicy (CTO 결정 1401-④)", () => {
    const ALL_ON = { slack: true, email: true, webhook: true };

    it("운영 기본값 — Slack Warning 이상 / Email Critical 이상 / Webhook Warning 이상 / 해소 포함", () => {
      const policy = resolveChannelPolicy({}, ALL_ON);
      const byChannel = Object.fromEntries(
        policy.map((entry) => [entry.channel, entry]),
      );
      expect(byChannel.slack).toMatchObject({ minLevel: "warning", resolved: true });
      expect(byChannel.email).toMatchObject({ minLevel: "critical", resolved: true });
      expect(byChannel.webhook).toMatchObject({ minLevel: "warning", resolved: true });
      expect(DEFAULT_CHANNEL_POLICY.email.minLevel).toBe("critical");
    });

    it("환경변수로 변경할 수 있다", () => {
      const policy = resolveChannelPolicy(
        {
          ALERT_SLACK_MIN_LEVEL: "critical",
          ALERT_EMAIL_MIN_LEVEL: "warning",
          ALERT_WEBHOOK_RESOLVED: "0",
        },
        ALL_ON,
      );
      const byChannel = Object.fromEntries(
        policy.map((entry) => [entry.channel, entry]),
      );
      expect(byChannel.slack.minLevel).toBe("critical");
      expect(byChannel.email.minLevel).toBe("warning");
      expect(byChannel.webhook.resolved).toBe(false);
    });

    it("알 수 없는 값은 기본값으로 되돌린다", () => {
      const policy = resolveChannelPolicy(
        { ALERT_EMAIL_MIN_LEVEL: "urgent" },
        ALL_ON,
      );
      expect(
        policy.find((entry) => entry.channel === "email")!.minLevel,
      ).toBe("critical");
    });

    it("주소가 없는 채널은 꺼진 상태로 온다", () => {
      const policy = resolveChannelPolicy({}, {
        slack: false,
        email: false,
        webhook: true,
      });
      expect(policy.filter((entry) => entry.enabled)).toHaveLength(1);
    });

    it("기본 정책에서 warning은 메일로 가지 않는다 — 메일은 쌓이면 안 읽는다", () => {
      const policy = resolveChannelPolicy({}, ALL_ON);
      expect(selectChannels(policy, "warning")).toEqual(["slack", "webhook"]);
      expect(selectChannels(policy, "critical")).toEqual([
        "slack",
        "email",
        "webhook",
      ]);
    });
  });

  describe("Persistent Queue (CTO 결정 1401-②)", () => {
    const now = 1_000_000;

    it("성공하면 sent", () => {
      expect(decideQueueOutcome(1, { ok: true, status: 200 }, now)).toMatchObject({
        outcome: "sent",
      });
    });

    it("일시적 실패는 retry — 다음 시도 시각을 계산한다", () => {
      expect(
        decideQueueOutcome(1, { ok: false, status: 503 }, now),
      ).toMatchObject({ outcome: "retry", nextAttemptAt: now + 1_000 });
      expect(
        decideQueueOutcome(3, { ok: false, status: null }, now).nextAttemptAt,
      ).toBe(now + 4_000);
    });

    it("되돌릴 수 없는 실패는 즉시 Dead Letter", () => {
      const decision = decideQueueOutcome(1, { ok: false, status: 404 }, now);
      expect(decision.outcome).toBe("dead");
      expect(decision.reason).toContain("설정을 고쳐야");
    });

    it("최대 시도를 소진하면 Dead Letter — 죽은 채널에 매달리지 않는다", () => {
      expect(
        decideQueueOutcome(4, { ok: false, status: 500 }, now).outcome,
      ).toBe("dead");
    });

    it("isDue — 지금 보낼 수 있는 항목만 집어 간다", () => {
      const item: QueueItemState = {
        id: "q1",
        channel: "slack",
        attempts: 1,
        status: "PENDING",
        nextAttemptAt: now,
      };
      expect(isDue(item, now)).toBe(true);
      expect(isDue({ ...item, nextAttemptAt: now + 1 }, now)).toBe(false);
      // 이미 보냈거나 죽은 항목은 다시 집지 않는다
      expect(isDue({ ...item, status: "SENT" }, now)).toBe(false);
      expect(isDue({ ...item, status: "DEAD" }, now)).toBe(false);
    });

    it("summarizeQueue — 대기·성공·Dead Letter를 구분해 센다", () => {
      const items: QueueItemState[] = [
        { id: "1", channel: "slack", attempts: 1, status: "PENDING", nextAttemptAt: now },
        { id: "2", channel: "slack", attempts: 1, status: "PENDING", nextAttemptAt: now + 10_000 },
        { id: "3", channel: "email", attempts: 1, status: "SENT", nextAttemptAt: now },
        { id: "4", channel: "webhook", attempts: 4, status: "DEAD", nextAttemptAt: now },
      ];
      expect(summarizeQueue(items, now)).toEqual({
        pending: 2,
        sent: 1,
        dead: 1,
        due: 1,
      });
    });
  });
});

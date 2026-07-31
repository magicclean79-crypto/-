import { configuredUrgentChannels, routeNotification, urgentChannelStatus } from "./urgent-routing";
import type { ChannelConfig } from "./notification";

/**
 * 긴급 알림 경로 검증. (TASK-3901 — CTO 정책 3901-④)
 *
 * 분리의 진짜 위험은 **침묵**이다: 긴급 채널을 설정하지 않으면 급한 알림만
 * 아무 데도 안 가고, 그 침묵은 "조용하다"로 읽힌다. 여기서 지키는 것은
 * **미구성을 침묵으로 바꾸지 않는가**다.
 */
describe("긴급 알림 경로 (TASK-3901)", () => {
  const config = (overrides: Partial<ChannelConfig> = {}): ChannelConfig => ({
    channel: "slack",
    enabled: true,
    minLevel: "warning",
    resolved: true,
    ...overrides,
  });

  const configs = [config(), config({ channel: "webhook" })];

  it("일반 알림은 일반 경로로 간다", () => {
    const route = routeNotification({
      level: "warning",
      configs,
      urgentConfigured: ["slack"],
    });
    expect(route.urgent).toBe(false);
    expect(route.channels).toEqual(["slack", "webhook"]);
  });

  it("긴급 알림은 긴급 주소가 있는 채널로만 간다", () => {
    const route = routeNotification({
      level: "critical",
      configs,
      urgentConfigured: ["webhook"],
    });
    expect(route.urgent).toBe(true);
    expect(route.usedFallback).toBe(false);
    expect(route.channels).toEqual(["webhook"]);
    expect(route.detail).toContain("긴급 경로");
  });

  it("긴급 채널이 없으면 일반으로 되돌리고 그 사실을 말한다 — 미구성을 침묵으로 바꾸지 않는다", () => {
    const route = routeNotification({
      level: "critical",
      configs,
      urgentConfigured: [],
    });
    expect(route.urgent).toBe(true);
    expect(route.usedFallback).toBe(true);
    expect(route.channels).toEqual(["slack", "webhook"]);
    expect(route.detail).toContain("긴급 경로가 설정되지 않아");
    expect(route.detail).toContain("ALERT_URGENT_");
  });

  it("끈 채널을 긴급이라고 켜지 않는다", () => {
    const route = routeNotification({
      level: "critical",
      configs: [config({ enabled: false })],
      urgentConfigured: ["slack"],
    });
    expect(route.channels).toEqual([]);
    expect(route.detail).toContain("보낼 채널이 하나도 없습니다");
  });

  it("채널이 하나도 없으면 로그가 유일한 흔적임을 말한다", () => {
    const route = routeNotification({
      level: "critical",
      configs: [],
      urgentConfigured: [],
    });
    expect(route.usedFallback).toBe(false);
    expect(route.detail).toContain("로그가 유일한 흔적");
  });

  it("해소 알림은 긴급이 아니다 — 풀렸다는 소식으로 사람을 깨우지 않는다", () => {
    const route = routeNotification({
      level: "resolved",
      configs,
      urgentConfigured: ["slack"],
    });
    expect(route.urgent).toBe(false);
  });

  describe("현황", () => {
    it("설정 여부만 알리고 주소는 노출하지 않는다", () => {
      const status = urgentChannelStatus({
        ALERT_URGENT_SLACK_WEBHOOK_URL: "https://hooks.example/secret",
      });
      const slack = status.find((row) => row.channel === "slack");
      expect(slack?.configured).toBe(true);
      expect(JSON.stringify(status)).not.toContain("secret");
    });

    it("빈 문자열은 미구성으로 본다", () => {
      expect(configuredUrgentChannels({ ALERT_URGENT_WEBHOOK_URL: "  " })).toEqual([]);
    });
  });
});

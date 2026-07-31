/**
 * 긴급 알림 경로 분리. (TASK-3901, Sprint 39 — CTO 정책 3901-④)
 *
 * 지금까지는 모든 알림이 같은 채널로 나갔습니다 — 활성화 완료(좋은 소식),
 * 예산 경고, 그리고 **운영 활성화가 풀렸다**(급함)가 같은 곳에 섞였습니다.
 * 섞이면 두 가지가 동시에 일어납니다: 급한 것이 안 급한 것들 사이에 묻히고,
 * 안 급한 것 때문에 채널이 시끄러워져 사람이 채널 자체를 음소거합니다.
 *
 * 그래서 **긴급 경로를 따로 둡니다.** `critical`은 긴급 채널로, 나머지는
 * 일반 채널로.
 *
 * ## 분리의 진짜 위험은 침묵입니다
 *
 * 경로를 나눈 순간 새 실패 방식이 생깁니다 — **긴급 채널을 설정하지
 * 않으면 급한 알림만 아무 데도 안 갑니다.** 그리고 그 침묵은 "조용하다"로
 * 읽힙니다. 분리 전보다 나빠지는 것입니다.
 *
 * 그래서 **미구성이면 일반 채널로 되돌립니다**(fallback). 되돌린 사실은
 * 숨기지 않고 `usedFallback`으로 남기고, 채널 현황 화면이 "긴급 경로가
 * 설정되지 않아 일반 채널로 나갑니다"라고 말합니다. **미구성을 침묵으로
 * 바꾸지 않습니다.**
 */

import type { ChannelConfig, NotificationChannel, NotificationLevel } from "./notification";
import { selectChannels } from "./notification";

/** 긴급 경로 환경변수 — 일반 채널과 **다른 주소**를 가리킨다 */
export const URGENT_CHANNEL_ENV: Record<NotificationChannel, string> = {
  slack: "ALERT_URGENT_SLACK_WEBHOOK_URL",
  webhook: "ALERT_URGENT_WEBHOOK_URL",
  email: "ALERT_URGENT_EMAIL_TO",
};

/** 어떤 알림이 긴급인가 — `critical`만이다 */
export function isUrgentLevel(level: NotificationLevel): boolean {
  return level === "critical";
}

export interface UrgentRouting {
  /** 실제로 보낼 채널 */
  channels: NotificationChannel[];
  /** 긴급 경로를 썼는가 */
  urgent: boolean;
  /** 긴급인데 긴급 채널이 없어 일반으로 되돌렸는가 */
  usedFallback: boolean;
  /** 사람이 읽는 설명 */
  detail: string;
}

/**
 * 이 알림을 어디로 보낼 것인가 (순수 함수, CTO 정책 3901-④).
 *
 * `urgentConfigured`는 채널별로 **긴급 주소가 설정돼 있는가**입니다.
 * 긴급인데 하나도 없으면 일반 채널로 되돌리고 그 사실을 말합니다.
 */
export function routeNotification(input: {
  level: NotificationLevel;
  /** 일반 채널 정책 */
  configs: ChannelConfig[];
  /** 긴급 주소가 설정된 채널 */
  urgentConfigured: NotificationChannel[];
}): UrgentRouting {
  const normal = selectChannels(input.configs, input.level);

  if (!isUrgentLevel(input.level)) {
    return {
      channels: normal,
      urgent: false,
      usedFallback: false,
      detail:
        normal.length === 0
          ? "전달 채널이 없어 로그로만 남깁니다."
          : `일반 경로 ${normal.join(" · ")}`,
    };
  }

  // 긴급이다. 긴급 주소가 있는 채널만 고른다 — 다만 **일반 정책상 이
  // 알림을 받기로 한 채널** 안에서 고른다(끈 채널을 긴급이라고 켜지 않는다).
  const urgentChannels = normal.filter((channel) =>
    input.urgentConfigured.includes(channel),
  );

  if (urgentChannels.length > 0) {
    return {
      channels: urgentChannels,
      urgent: true,
      usedFallback: false,
      detail: `긴급 경로 ${urgentChannels.join(" · ")}`,
    };
  }

  // **미구성을 침묵으로 바꾸지 않는다.**
  return {
    channels: normal,
    urgent: true,
    usedFallback: normal.length > 0,
    detail:
      normal.length === 0
        ? "긴급 알림인데 보낼 채널이 하나도 없습니다 — 로그가 유일한 흔적입니다."
        : `긴급 경로가 설정되지 않아 일반 채널로 보냅니다 (${normal.join(" · ")}). ` +
          `설정하려면 ${Object.values(URGENT_CHANNEL_ENV).join(" · ")} 중 하나를 두세요.`,
  };
}

export interface UrgentChannelStatus {
  channel: NotificationChannel;
  env: string;
  configured: boolean;
}

/** 긴급 경로 현황 (주소는 노출하지 않는다) */
export function urgentChannelStatus(
  env: Record<string, string | undefined>,
): UrgentChannelStatus[] {
  return (Object.keys(URGENT_CHANNEL_ENV) as NotificationChannel[]).map((channel) => ({
    channel,
    env: URGENT_CHANNEL_ENV[channel],
    configured: Boolean(env[URGENT_CHANNEL_ENV[channel]]?.trim()),
  }));
}

/** 긴급 주소가 설정된 채널 목록 */
export function configuredUrgentChannels(
  env: Record<string, string | undefined>,
): NotificationChannel[] {
  return urgentChannelStatus(env)
    .filter((status) => status.configured)
    .map((status) => status.channel);
}

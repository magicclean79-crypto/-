/**
 * Teams Adaptive Card 전환. (TASK-4601, Sprint 46 — CTO 정책 4601-③)
 *
 * TASK-4501은 Teams를 **MessageCard**로 붙였습니다. 동작하지만 그 형식은
 * Microsoft가 유지 모드로 두었고, Office 365 Connector 자체가 단계적으로
 * 정리되는 중입니다. 후속 경로는 **Adaptive Card를 Workflows(Power Automate)
 * incoming webhook으로** 보내는 것입니다.
 *
 * ## 왜 지금 바꾸지 않고 둘 다 두는가
 *
 * 이 저장소는 **실제 Teams 워크스페이스에 붙어 본 적이 없습니다.** 지금
 * 기본값을 Adaptive Card로 바꾸면, 우리가 확인할 수 없는 형식으로 알림이
 * 나가고 **실패는 첫 장애 때** 알게 됩니다. 그건 알림 체계에서 가장 하면
 * 안 되는 종류의 변경입니다.
 *
 * 그래서:
 *
 * 1. **두 형식을 모두 만듭니다.** 코드는 준비됐습니다.
 * 2. **기본값은 아직 MessageCard입니다.** 바꾸는 것은 `TEAMS_CARD_FORMAT`
 *    선언 한 줄이며, 되돌리는 것도 같은 한 줄입니다.
 * 3. **두 형식이 같은 사실을 담는지 테스트가 검사합니다.** 형식이 둘이면
 *    한쪽만 고치는 날이 오고, 그때 같은 장애에 두 개의 답이 생깁니다.
 *
 * 전환 절차와 되돌리는 법은 `docs/operations/teams-adaptive-card-plan.md`에
 * 적었습니다 — 되돌리는 법이 안 적힌 단계는 사고 났을 때 지어내게 됩니다.
 */

import type { NotificationPayload } from "./notification";

/** 보낼 수 있는 Teams 본문 형식 */
export const TEAMS_CARD_FORMATS = ["message-card", "adaptive"] as const;
export type TeamsCardFormat = (typeof TEAMS_CARD_FORMATS)[number];

/**
 * 기본값은 **아직 MessageCard**입니다 (CTO 정책 4601-③).
 *
 * 실제 Teams 워크스페이스에서 확인하기 전에는 바꾸지 않습니다 — 확인하지
 * 않은 형식을 기본값으로 두면, 그 형식이 틀렸다는 사실을 첫 장애 때
 * 알게 됩니다.
 */
export const DEFAULT_TEAMS_CARD_FORMAT: TeamsCardFormat = "message-card";

/** `TEAMS_CARD_FORMAT` 환경변수 이름 */
export const TEAMS_CARD_FORMAT_ENV = "TEAMS_CARD_FORMAT";

export interface TeamsFormatChoice {
  format: TeamsCardFormat;
  /** 선언이 있었는가 */
  declared: boolean;
  /** 선언이 있었지만 읽을 수 없었는가 */
  rejected: string | null;
  detail: string;
}

/**
 * 어떤 형식으로 보낼 것인가 (순수 함수).
 *
 * **알 수 없는 값은 기본값으로 되돌리되 그 사실을 말합니다.** 조용히
 * 되돌리면 오타 하나로 "바꿨다고 믿는데 안 바뀐" 상태가 되고, 그 차이는
 * 다음 장애 때 드러납니다.
 */
export function resolveTeamsFormat(
  env: Record<string, string | undefined>,
): TeamsFormatChoice {
  const raw = env[TEAMS_CARD_FORMAT_ENV]?.trim();
  if (!raw) {
    return {
      format: DEFAULT_TEAMS_CARD_FORMAT,
      declared: false,
      rejected: null,
      detail:
        "Teams 본문은 MessageCard입니다(기본값). Adaptive Card로 바꾸려면 " +
        `${TEAMS_CARD_FORMAT_ENV}=adaptive 한 줄이며, 되돌리는 것도 같은 한 줄입니다.`,
    };
  }
  if ((TEAMS_CARD_FORMATS as readonly string[]).includes(raw)) {
    return {
      format: raw as TeamsCardFormat,
      declared: true,
      rejected: null,
      detail: `Teams 본문 형식을 ${raw}로 선언했습니다.`,
    };
  }
  return {
    format: DEFAULT_TEAMS_CARD_FORMAT,
    declared: true,
    rejected: raw,
    detail:
      `${TEAMS_CARD_FORMAT_ENV}에 알 수 없는 값("${raw}")이 있어 기본값` +
      `(${DEFAULT_TEAMS_CARD_FORMAT})으로 보냅니다 — 바꿨다고 믿는 상태로 ` +
      "두지 않으려고 그대로 적습니다.",
  };
}

const LEVEL_LABEL: Record<NotificationPayload["level"], string> = {
  warning: "주의",
  critical: "심각",
  resolved: "해소",
};

const LEVEL_EMOJI: Record<NotificationPayload["level"], string> = {
  warning: "⚠️",
  critical: "🚨",
  resolved: "✅",
};

/**
 * Adaptive Card는 색 이름을 쓴다 — 그래도 **글자로도 남깁니다.**
 * 색만으로 등급을 전하면 색을 구분하지 못하는 사람에게는 등급이 없는
 * 알림입니다(4501-③과 같은 규칙).
 */
const LEVEL_ADAPTIVE_COLOR: Record<NotificationPayload["level"], string> = {
  warning: "Warning",
  critical: "Attention",
  resolved: "Good",
};

/**
 * Adaptive Card 1.4 본문 — Workflows incoming webhook이 받는 봉투까지 포함.
 *
 * Teams의 Workflows 웹훅은 카드를 **`attachments` 봉투에 담아** 받습니다.
 * 봉투 없이 카드만 보내면 200을 받고도 아무것도 안 뜹니다 — 성공으로
 * 기록되는 실패이며, 우리가 가장 경계하는 모양입니다.
 */
export function teamsAdaptiveBody(
  payload: NotificationPayload,
): Record<string, unknown> {
  const facts = [
    { title: "심각도", value: LEVEL_LABEL[payload.level] },
    { title: "종류", value: payload.kind },
    { title: "키", value: payload.key },
    { title: "환경", value: payload.environment },
    { title: "시각", value: payload.at },
  ];

  const card: Record<string, unknown> = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: `${LEVEL_EMOJI[payload.level]} [${LEVEL_LABEL[payload.level]}] ${payload.title}`,
        weight: "Bolder",
        size: "Medium",
        wrap: true,
        color: LEVEL_ADAPTIVE_COLOR[payload.level],
      },
      { type: "TextBlock", text: payload.message, wrap: true },
      { type: "FactSet", facts },
    ],
    ...(payload.url === null
      ? {}
      : {
          // 주소가 없으면 버튼을 만들지 않습니다 — 눌러도 아무 데도 안 가는
          // 버튼은 없느니만 못합니다.
          actions: [
            { type: "Action.OpenUrl", title: "화면에서 보기", url: payload.url },
          ],
        }),
  };

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: card,
      },
    ],
  };
}

/**
 * 두 형식이 담아야 하는 **사실** — 형식이 둘이면 한쪽만 고치는 날이 오고,
 * 그때 같은 장애에 두 개의 답이 생깁니다. 테스트가 이 목록으로 검사합니다.
 */
export function teamsCardFacts(payload: NotificationPayload): string[] {
  return [
    LEVEL_LABEL[payload.level],
    payload.title,
    payload.message,
    payload.kind,
    payload.key,
    payload.environment,
    payload.at,
    ...(payload.url === null ? [] : [payload.url]),
  ];
}

import { teamsBody } from "./notification";
import type { NotificationPayload } from "./notification";
import {
  DEFAULT_TEAMS_CARD_FORMAT,
  resolveTeamsFormat,
  teamsAdaptiveBody,
  teamsCardFacts,
} from "./teams-card";

function payload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    level: overrides.level ?? "critical",
    kind: overrides.kind ?? "provider",
    key: overrides.key ?? "provider-failure:openai",
    title: overrides.title ?? "OpenAI 호출 실패",
    message: overrides.message ?? "최근 10분 동안 12건 실패했습니다.",
    at: overrides.at ?? "2026-07-31T12:00:00.000Z",
    environment: overrides.environment ?? "staging",
    url: overrides.url === undefined ? "https://acos.example/ops" : overrides.url,
  };
}

describe("resolveTeamsFormat (TASK-4601, 정책 4601-③)", () => {
  /**
   * 실제 Teams 워크스페이스에서 확인하기 전에 기본값을 바꾸면, 그 형식이
   * 틀렸다는 사실을 첫 장애 때 알게 된다.
   */
  it("기본값은 아직 MessageCard다", () => {
    const choice = resolveTeamsFormat({});
    expect(choice.format).toBe("message-card");
    expect(DEFAULT_TEAMS_CARD_FORMAT).toBe("message-card");
    expect(choice.declared).toBe(false);
  });

  it("선언하면 Adaptive Card로 바꾼다", () => {
    const choice = resolveTeamsFormat({ TEAMS_CARD_FORMAT: "adaptive" });
    expect(choice.format).toBe("adaptive");
    expect(choice.declared).toBe(true);
  });

  /**
   * 조용히 되돌리면 오타 하나로 "바꿨다고 믿는데 안 바뀐" 상태가 되고,
   * 그 차이는 다음 장애 때 드러난다.
   */
  it("알 수 없는 값은 기본값으로 되돌리되 그 사실을 말한다", () => {
    const choice = resolveTeamsFormat({ TEAMS_CARD_FORMAT: "adaptivecard" });
    expect(choice.format).toBe("message-card");
    expect(choice.rejected).toBe("adaptivecard");
    expect(choice.detail).toContain("adaptivecard");
  });

  it("되돌리는 법을 문장에 적는다", () => {
    expect(resolveTeamsFormat({}).detail).toContain("되돌리는 것도 같은 한 줄");
  });
});

describe("teamsAdaptiveBody (TASK-4601, 정책 4601-③)", () => {
  /**
   * 봉투 없이 카드만 보내면 200을 받고도 아무것도 안 뜬다 — 성공으로
   * 기록되는 실패이며, 우리가 가장 경계하는 모양이다.
   */
  it("Workflows 웹훅이 받는 봉투에 담는다", () => {
    const body = teamsAdaptiveBody(payload());
    expect(body.type).toBe("message");
    const attachments = body.attachments as { contentType: string; content: unknown }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0].contentType).toBe(
      "application/vnd.microsoft.card.adaptive",
    );
  });

  it("Adaptive Card 스키마와 버전을 밝힌다", () => {
    const card = cardOf(teamsAdaptiveBody(payload()));
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.4");
  });

  /**
   * 색만 쓰면 색을 구분하지 못하는 사람에게는 등급이 없는 알림이다.
   */
  it("심각도를 색과 글자 둘 다로 남긴다", () => {
    const card = cardOf(teamsAdaptiveBody(payload({ level: "critical" })));
    const blocks = card.body as Record<string, unknown>[];
    expect(blocks[0].color).toBe("Attention");
    expect(String(blocks[0].text)).toContain("[심각]");
    const facts = (blocks[2].facts as { title: string; value: string }[]).find(
      (fact) => fact.title === "심각도",
    );
    expect(facts?.value).toBe("심각");
  });

  /**
   * 눌러도 아무 데도 안 가는 버튼은 없느니만 못하다.
   */
  it("주소가 없으면 버튼을 만들지 않는다", () => {
    const card = cardOf(teamsAdaptiveBody(payload({ url: null })));
    expect(card.actions).toBeUndefined();
    const withUrl = cardOf(teamsAdaptiveBody(payload()));
    expect((withUrl.actions as { url: string }[])[0].url).toBe(
      "https://acos.example/ops",
    );
  });

  /**
   * 형식이 둘이면 한쪽만 고치는 날이 오고, 그때 같은 장애에 두 개의 답이
   * 생긴다.
   */
  it("MessageCard와 같은 사실을 담는다", () => {
    for (const input of [payload(), payload({ url: null, level: "resolved" })]) {
      const adaptive = JSON.stringify(teamsAdaptiveBody(input));
      const messageCard = JSON.stringify(teamsBody(input));
      for (const fact of teamsCardFacts(input)) {
        expect(adaptive).toContain(fact);
        expect(messageCard).toContain(fact);
      }
    }
  });

  it("주소가 없는 알림의 주소를 사실 목록에 넣지 않는다", () => {
    expect(teamsCardFacts(payload({ url: null }))).not.toContain(null as never);
  });
});

function cardOf(body: Record<string, unknown>): Record<string, unknown> {
  const attachments = body.attachments as { content: Record<string, unknown> }[];
  return attachments[0].content;
}

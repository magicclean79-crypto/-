import {
  buildOpsOverview,
  OVERVIEW_DOMAINS,
  type OverviewStatus,
} from "./ops-overview";

function states(
  overrides: Record<string, OverviewStatus> = {},
  next: Record<string, string> = {},
): Record<string, { status: OverviewStatus; detail: string; next?: string | null }> {
  const result: Record<
    string,
    { status: OverviewStatus; detail: string; next?: string | null }
  > = {};
  for (const domain of OVERVIEW_DOMAINS) {
    result[domain.id] = {
      status: overrides[domain.id] ?? "ok",
      detail: `${domain.title} 상태`,
      next: next[domain.id] ?? null,
    };
  }
  return result;
}

describe("buildOpsOverview (TASK-4601, 정책 4601-⑤)", () => {
  it("네 갈래를 모으고 각 칸이 출처를 달고 있다", () => {
    const report = buildOpsOverview({ states: states() });
    expect(report.tiles.map((tile) => tile.id)).toEqual([
      "validation",
      "attribution",
      "notification",
      "recovery",
    ]);
    for (const tile of report.tiles) {
      expect(tile.source).toMatch(/^GET \//);
      expect(tile.question.length).toBeGreaterThan(0);
    }
  });

  it("전부 정상이면 정상이다", () => {
    const report = buildOpsOverview({ states: states() });
    expect(report.status).toBe("ok");
    expect(report.unknown).toBe(0);
  });

  it("최악값을 따른다", () => {
    expect(buildOpsOverview({ states: states({ recovery: "warn" }) }).status).toBe(
      "warn",
    );
    expect(
      buildOpsOverview({ states: states({ recovery: "warn", validation: "fail" }) })
        .status,
    ).toBe("fail");
  });

  /**
   * 못 읽은 갈래가 있는데 나머지가 초록이면, "전체 정상"이라는 한 줄은
   * 거짓말이 된다.
   */
  it("읽지 못한 갈래를 요약 문장에 먼저 적는다", () => {
    const base = states();
    delete base.notification;
    const report = buildOpsOverview({ states: base });
    expect(report.unknown).toBe(1);
    expect(report.unread).toBe(1);
    expect(report.detail.startsWith("1개 갈래를 읽지 못했습니다")).toBe(true);
    expect(report.detail).toContain("Notification");
  });

  /**
   * 라이브에서 잡은 결함: 표본이 모자라 판정을 유보한 갈래를 "읽지
   * 못했다"고 적었다. 같은 화면의 칸은 "표본이 20건에 못 미쳐 판정하지
   * 않았습니다"라고 말하는데 요약은 "못 읽었다"고 말했다 — 같은 사실에
   * 두 개의 답이다. 둘 다 통과가 아니지만 **사람이 할 일이 다르다.**
   */
  it("못 읽은 것과 판정을 유보한 것을 가른다", () => {
    const report = buildOpsOverview({
      states: states({ attribution: "unknown" }),
    });
    expect(report.unread).toBe(0);
    expect(report.undecided).toBe(1);
    expect(report.detail).not.toContain("읽지 못했습니다");
    expect(report.detail).toContain("판정을 유보했습니다");
    expect(report.detail).toContain("정상이라는 뜻이 아니라");
  });

  it("판정을 유보한 갈래도 확실하지 않은 것으로 센다", () => {
    const report = buildOpsOverview({
      states: states({ attribution: "unknown" }),
    });
    expect(report.unknown).toBe(1);
    expect(report.status).not.toBe("ok");
    // 세는 자리에서는 "못 읽음"과 "판정 유보"를 한 칸에 담으므로, 둘 중
    // 한쪽 이름으로 부르면 화면의 칸과 요약이 다른 말을 하게 된다.
    expect(report.detail).toContain("확실하지 않음 1");
    expect(report.detail).not.toContain("확인 못 함");
  });

  it("둘이 섞이면 각각 따로 말한다", () => {
    const base = states({ attribution: "unknown" });
    delete base.recovery;
    const report = buildOpsOverview({ states: base });
    expect(report.unread).toBe(1);
    expect(report.undecided).toBe(1);
    expect(report.detail).toContain("읽지 못했습니다(Recovery)");
    expect(report.detail).toContain("판정을 유보했습니다(Attribution)");
  });

  /**
   * 모르는 것이 주의보다 가벼우면, 못 읽은 갈래가 많은 환경이 건강해 보인다.
   */
  it("읽지 못한 갈래를 정상으로 요약하지 않는다", () => {
    const report = buildOpsOverview({ states: {} });
    expect(report.status).not.toBe("ok");
    expect(report.tiles.every((tile) => tile.status === "unknown")).toBe(true);
    expect(report.tiles.every((tile) => !tile.read)).toBe(true);
    expect(report.unread).toBe(4);
  });

  /**
   * 네 개를 나란히 보여 주면 어디부터 손대야 하는지는 여전히 사람이 골라야
   * 한다.
   */
  it("가장 나쁜 갈래의 할 일을 앞으로 끌어올린다", () => {
    const report = buildOpsOverview({
      states: states(
        { attribution: "warn", notification: "fail" },
        { attribution: "귀속을 붙이세요", notification: "채널 주소를 확인하세요" },
      ),
    });
    expect(report.nextAction).toBe("채널 주소를 확인하세요");
    expect(report.detail).toContain("먼저 할 일: Notification");
  });

  it("할 일이 없으면 null이다 — 지어내지 않는다", () => {
    expect(buildOpsOverview({ states: states() }).nextAction).toBeNull();
  });

  it("읽지 못한 칸의 문장이 괜찮다는 뜻이 아님을 밝힌다", () => {
    const report = buildOpsOverview({ states: {} });
    expect(report.tiles[0].detail).toContain("괜찮다는 뜻이 아닙니다");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    for (const input of [states(), states({ validation: "fail" }), {}]) {
      const report = buildOpsOverview({ states: input });
      expect(report.detail).not.toContain("**");
      for (const tile of report.tiles) {
        expect(tile.detail).not.toContain("**");
        expect(tile.question).not.toContain("**");
      }
    }
  });
});

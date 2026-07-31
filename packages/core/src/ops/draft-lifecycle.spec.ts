import {
  DRAFT_EXPIRE_AFTER_MS,
  DRAFT_EXPIRE_KEY,
  DRAFT_STALE_AFTER_MS,
  DRAFT_STALE_KEY,
  detectStaleDraftAlerts,
  judgeDraftLifecycle,
  resolveDraftLifecycleSettings,
} from "./draft-lifecycle";
import type { DraftAge } from "./draft-lifecycle";

const NOW = Date.parse("2026-07-31T00:00:00Z");

function draft(id: string, ageMs: number): DraftAge {
  return {
    id,
    summary: `초안 ${id}`,
    createdAt: NOW - ageMs,
    sourceAlertKey: `provider-failure:${id}`,
  };
}

describe("judgeDraftLifecycle", () => {
  it("수명을 넘기지 않은 초안은 아무것도 아니다", () => {
    const report = judgeDraftLifecycle({
      drafts: [draft("a", 60_000), draft("b", DRAFT_STALE_AFTER_MS - 1)],
      now: NOW,
    });
    expect(report.stale).toHaveLength(0);
    expect(report.expiring).toHaveLength(0);
    expect(report.detail).toContain("수명을 넘긴 초안이 없습니다");
  });

  it("확인되지 않은 채 오래된 초안을 경보 대상으로 낸다", () => {
    const report = judgeDraftLifecycle({
      drafts: [draft("a", DRAFT_STALE_AFTER_MS + 1)],
      now: NOW,
    });
    expect(report.stale.map((row) => row.id)).toEqual(["a"]);
    expect(report.detail).toContain("아무도 보지 않았다");
  });

  it("만료 대상은 경보 대상에서 뺀다 — 만료시키며 봐 달라고 부르지 않는다", () => {
    const report = judgeDraftLifecycle({
      drafts: [draft("old", DRAFT_EXPIRE_AFTER_MS + 1), draft("mid", DRAFT_STALE_AFTER_MS + 1)],
      now: NOW,
    });
    expect(report.expiring.map((row) => row.id)).toEqual(["old"]);
    expect(report.stale.map((row) => row.id)).toEqual(["mid"]);
  });

  it("만료를 기각으로 말하지 않는다", () => {
    const report = judgeDraftLifecycle({
      drafts: [draft("old", DRAFT_EXPIRE_AFTER_MS + 1)],
      now: NOW,
    });
    expect(report.detail).toContain("다음 정리에서 만료로 표시될");
    expect(report.detail).toContain("기각이 아니라");
    expect(report.detail).toContain("아무도 판단하지 않았다");
    expect(report.detail).toContain("목록에서 사라지지 않습니다");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const report = judgeDraftLifecycle({
      drafts: [draft("old", DRAFT_EXPIRE_AFTER_MS + 1), draft("mid", DRAFT_STALE_AFTER_MS + 1)],
      now: NOW,
    });
    expect(report.detail).not.toContain("**");
  });
});

describe("detectStaleDraftAlerts", () => {
  it("방치된 초안이 없으면 경보도 없다", () => {
    const report = judgeDraftLifecycle({ drafts: [draft("a", 1000)], now: NOW });
    expect(detectStaleDraftAlerts(report)).toEqual([]);
  });

  it("초안이 몇 건이든 경보는 1건으로 묶는다", () => {
    const report = judgeDraftLifecycle({
      drafts: ["a", "b", "c", "d", "e"].map((id) => draft(id, DRAFT_STALE_AFTER_MS + 1)),
      now: NOW,
    });
    const alerts = detectStaleDraftAlerts(report);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe("incident-draft:stale");
    expect(alerts[0].title).toContain("5건");
    // 앞의 3건만 나열하고 나머지는 개수로 — 경보 문구가 목록이 되면 안 읽힌다
    expect(alerts[0].message).toContain("외 2건");
  });

  it("경보는 차단이 아니라 warning이다", () => {
    const report = judgeDraftLifecycle({
      drafts: [draft("a", DRAFT_STALE_AFTER_MS + 1)],
      now: NOW,
    });
    expect(detectStaleDraftAlerts(report)[0].level).toBe("warning");
  });
});

describe("resolveDraftLifecycleSettings", () => {
  it("설정이 없으면 기본값", () => {
    const resolved = resolveDraftLifecycleSettings({});
    expect(resolved.staleAfterMs).toBe(DRAFT_STALE_AFTER_MS);
    expect(resolved.expireAfterMs).toBe(DRAFT_EXPIRE_AFTER_MS);
    expect(resolved.rejected).toEqual([]);
  });

  it("범위 안의 값을 받아들인다", () => {
    const resolved = resolveDraftLifecycleSettings({
      [DRAFT_STALE_KEY]: "7",
      [DRAFT_EXPIRE_KEY]: "60",
    });
    expect(resolved.staleAfterMs).toBe(7 * 86_400_000);
    expect(resolved.expireAfterMs).toBe(60 * 86_400_000);
  });

  it("범위 밖의 값은 이유를 남기고 기본값으로 되돌린다", () => {
    const resolved = resolveDraftLifecycleSettings({ [DRAFT_STALE_KEY]: "0" });
    expect(resolved.staleAfterMs).toBe(DRAFT_STALE_AFTER_MS);
    expect(resolved.rejected[0].key).toBe(DRAFT_STALE_KEY);
  });

  it("만료가 경보보다 빠르면 경보가 한 번도 나지 않으므로 둘 다 되돌린다", () => {
    const resolved = resolveDraftLifecycleSettings({
      [DRAFT_STALE_KEY]: "20",
      [DRAFT_EXPIRE_KEY]: "10",
    });
    expect(resolved.staleAfterMs).toBe(DRAFT_STALE_AFTER_MS);
    expect(resolved.expireAfterMs).toBe(DRAFT_EXPIRE_AFTER_MS);
    expect(resolved.rejected.some((row) => row.key === DRAFT_EXPIRE_KEY)).toBe(true);
  });
});

import {
  DEFAULT_ARCHIVE_AFTER_DAYS,
  matchesFilter,
  planArchive,
  resolveArchiveAfterDays,
  summarizeHistory,
} from "./alert-archive";
import type { ArchivableAlert, HistoryEntry } from "./alert-archive";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

function alert(overrides: Partial<ArchivableAlert> = {}): ArchivableAlert {
  return {
    key: overrides.key ?? "budget:daily",
    status: overrides.status ?? "RESOLVED",
    resolvedAt:
      overrides.resolvedAt !== undefined ? overrides.resolvedAt : NOW - 100 * DAY,
  };
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    key: overrides.key ?? "budget:daily",
    kind: overrides.kind ?? "budget",
    level: overrides.level ?? "critical",
    status: overrides.status ?? "RESOLVED",
    firstRaisedAt: overrides.firstRaisedAt ?? NOW - 2 * DAY,
    lastRaisedAt: overrides.lastRaisedAt ?? NOW - DAY,
    resolvedAt:
      overrides.resolvedAt !== undefined ? overrides.resolvedAt : NOW - DAY,
    occurrences: overrides.occurrences ?? 1,
  };
}

describe("Alert History & Archive (TASK-1401, CTO 결정 1302-④)", () => {
  describe("resolveArchiveAfterDays", () => {
    it("기본 90일", () => {
      expect(resolveArchiveAfterDays({})).toBe(DEFAULT_ARCHIVE_AFTER_DAYS);
      expect(DEFAULT_ARCHIVE_AFTER_DAYS).toBe(90);
    });

    it("환경변수로 조정하고, 해석 불가 값은 기본값으로", () => {
      expect(resolveArchiveAfterDays({ ALERT_ARCHIVE_AFTER_DAYS: "30" })).toBe(30);
      // 잘못 적은 값 때문에 이력이 즉시 보관되면 안 된다
      expect(resolveArchiveAfterDays({ ALERT_ARCHIVE_AFTER_DAYS: "0" })).toBe(90);
      expect(resolveArchiveAfterDays({ ALERT_ARCHIVE_AFTER_DAYS: "-5" })).toBe(90);
      expect(resolveArchiveAfterDays({ ALERT_ARCHIVE_AFTER_DAYS: "abc" })).toBe(90);
      expect(resolveArchiveAfterDays({ ALERT_ARCHIVE_AFTER_DAYS: "  " })).toBe(90);
    });
  });

  describe("planArchive", () => {
    it("유예가 지난 해소 경보만 보관한다", () => {
      const plan = planArchive(
        [
          alert({ key: "old", resolvedAt: NOW - 100 * DAY }),
          alert({ key: "recent", resolvedAt: NOW - 10 * DAY }),
        ],
        { afterDays: 90, now: NOW },
      );
      expect(plan.archive).toEqual(["old"]);
      expect(plan.checked).toBe(2);
      expect(plan.afterDays).toBe(90);
    });

    it("활성 경보는 절대 보관하지 않는다 — 문제가 있는데 화면에서 사라지면 사고다", () => {
      const plan = planArchive(
        [alert({ key: "active", status: "ACTIVE", resolvedAt: null })],
        { afterDays: 90, now: NOW },
      );
      expect(plan.archive).toEqual([]);
    });

    it("이미 보관된 것은 다시 보관하지 않는다", () => {
      const plan = planArchive(
        [alert({ key: "done", status: "ARCHIVED" })],
        { afterDays: 90, now: NOW },
      );
      expect(plan.archive).toEqual([]);
    });

    it("해소 시각을 모르면 건드리지 않는다 — 유예가 지났는지 알 수 없다", () => {
      const plan = planArchive(
        [alert({ key: "unknown-time", status: "RESOLVED", resolvedAt: null })],
        { afterDays: 90, now: NOW },
      );
      expect(plan.archive).toEqual([]);
    });

    it("경계: 정확히 유예 시점이면 보관 대상", () => {
      const plan = planArchive([alert({ resolvedAt: NOW - 90 * DAY })], {
        afterDays: 90,
        now: NOW,
      });
      expect(plan.archive).toHaveLength(1);
    });
  });

  describe("matchesFilter", () => {
    it("종류·심각도·상태·기간으로 거른다", () => {
      const target = entry({ kind: "budget", level: "critical", status: "RESOLVED" });
      expect(matchesFilter(target, {})).toBe(true);
      expect(matchesFilter(target, { kind: "budget" })).toBe(true);
      expect(matchesFilter(target, { kind: "configuration" })).toBe(false);
      expect(matchesFilter(target, { level: "warning" })).toBe(false);
      expect(matchesFilter(target, { status: "ACTIVE" })).toBe(false);
      expect(matchesFilter(target, { since: NOW - 2 * DAY })).toBe(true);
      expect(matchesFilter(target, { since: NOW })).toBe(false);
    });
  });

  describe("summarizeHistory", () => {
    it("종류별 발생 횟수를 많은 순으로 낸다", () => {
      const summary = summarizeHistory([
        entry({ key: "a", kind: "budget", occurrences: 2 }),
        entry({ key: "b", kind: "provider-failure", occurrences: 9 }),
        entry({ key: "c", kind: "budget", occurrences: 3 }),
      ]);
      expect(summary.byKind).toEqual([
        { kind: "provider-failure", alerts: 1, occurrences: 9 },
        { kind: "budget", alerts: 2, occurrences: 5 },
      ]);
      expect(summary.total).toBe(3);
    });

    it("상태별 개수를 센다", () => {
      const summary = summarizeHistory([
        entry({ key: "a", status: "ACTIVE", resolvedAt: null }),
        entry({ key: "b", status: "RESOLVED" }),
        entry({ key: "c", status: "ARCHIVED" }),
      ]);
      expect(summary).toMatchObject({ active: 1, resolved: 1, archived: 1 });
    });

    it("평균 해소 시간 — 건수보다 방치 시간이 더 나쁜 신호다", () => {
      const summary = summarizeHistory([
        entry({ key: "a", firstRaisedAt: NOW - 4 * DAY, resolvedAt: NOW - 2 * DAY }),
        entry({ key: "b", firstRaisedAt: NOW - 2 * DAY, resolvedAt: NOW - DAY }),
      ]);
      expect(summary.meanTimeToResolveMs).toBe(1.5 * DAY);
    });

    it("해소된 것이 없으면 평균은 null — 0으로 속이지 않는다", () => {
      expect(
        summarizeHistory([entry({ status: "ACTIVE", resolvedAt: null })])
          .meanTimeToResolveMs,
      ).toBeNull();
      expect(summarizeHistory([]).meanTimeToResolveMs).toBeNull();
    });
  });
});

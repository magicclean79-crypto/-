/**
 * Alert History & Archive. (TASK-1401, Sprint 14 — CTO 결정 1302-④)
 *
 * **경보는 삭제하지 않는다.** 해소된 지 90일이 지나면 보관(Archive)으로
 * 옮겨 현황 화면에서 비켜 두되, 이력 자체는 남긴다 — 언제 났다가 언제
 * 풀렸는지가 사고 분석의 근거이기 때문이다.
 *
 * 보관과 삭제를 구분하는 이유는 분명하다: 삭제는 되돌릴 수 없고, "그때
 * 그 경보가 있었나?"를 나중에 확인할 방법을 영원히 없앤다.
 */

/** 보관 대상 판정에 필요한 최소 정보 */
export interface ArchivableAlert {
  key: string;
  status: "ACTIVE" | "RESOLVED" | "ARCHIVED";
  /** 해소 시각 (epoch ms) — 미해소면 null */
  resolvedAt: number | null;
}

/** 기본 보관 유예 — CTO 결정 1302-④ */
export const DEFAULT_ARCHIVE_AFTER_DAYS = 90;

export const ARCHIVE_AFTER_DAYS_ENV = "ALERT_ARCHIVE_AFTER_DAYS";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 보관 유예(일)를 환경에서 읽는다.
 * 해석할 수 없거나 0 이하이면 기본값 — 잘못 적은 값 때문에 이력이 즉시
 * 보관되는 것보다 안전하다.
 */
export function resolveArchiveAfterDays(
  env: Record<string, string | undefined>,
): number {
  const raw = env[ARCHIVE_AFTER_DAYS_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_ARCHIVE_AFTER_DAYS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed)
    : DEFAULT_ARCHIVE_AFTER_DAYS;
}

export interface ArchivePlan {
  /** 보관으로 옮길 경보 키 */
  archive: string[];
  /** 판정 기준 시각 (이보다 전에 해소된 것이 대상) */
  cutoff: number;
  afterDays: number;
  /** 검사한 경보 수 */
  checked: number;
}

/**
 * 보관 대상을 고른다 (순수 함수).
 *
 * - **활성 경보는 절대 보관하지 않는다** — 아직 문제가 있는데 화면에서
 *   사라지면 그게 사고다.
 * - 이미 보관된 것은 다시 보관하지 않는다.
 * - 해소 시각이 없는 RESOLVED는 건드리지 않는다 — 언제 풀렸는지 모르면
 *   유예가 지났는지도 알 수 없다(모르는 것을 처리하지 않는다).
 */
export function planArchive(
  alerts: ArchivableAlert[],
  options: { afterDays: number; now: number },
): ArchivePlan {
  const cutoff = options.now - options.afterDays * DAY_MS;
  const archive = alerts
    .filter(
      (alert) =>
        alert.status === "RESOLVED" &&
        alert.resolvedAt !== null &&
        alert.resolvedAt <= cutoff,
    )
    .map((alert) => alert.key);

  return {
    archive,
    cutoff,
    afterDays: options.afterDays,
    checked: alerts.length,
  };
}

// ── Alert History 조회 ───────────────────────────────────────

export interface HistoryFilter {
  kind?: string;
  level?: "warning" | "critical";
  status?: "ACTIVE" | "RESOLVED" | "ARCHIVED";
  /** 이 시각 이후 (epoch ms) */
  since?: number;
}

export interface HistoryEntry {
  key: string;
  kind: string;
  level: "warning" | "critical";
  status: "ACTIVE" | "RESOLVED" | "ARCHIVED";
  firstRaisedAt: number;
  lastRaisedAt: number;
  resolvedAt: number | null;
  occurrences: number;
}

/** 이력 필터 — 저장소가 지원하지 않는 조합도 순수 로직으로 걸러 낼 수 있다 */
export function matchesFilter(
  entry: HistoryEntry,
  filter: HistoryFilter,
): boolean {
  if (filter.kind && entry.kind !== filter.kind) {
    return false;
  }
  if (filter.level && entry.level !== filter.level) {
    return false;
  }
  if (filter.status && entry.status !== filter.status) {
    return false;
  }
  if (filter.since !== undefined && entry.lastRaisedAt < filter.since) {
    return false;
  }
  return true;
}

export interface HistorySummary {
  total: number;
  active: number;
  resolved: number;
  archived: number;
  /** 종류별 발생 횟수 (occurrences 합계) — 무엇이 자주 나는지 */
  byKind: { kind: string; alerts: number; occurrences: number }[];
  /** 해소까지 걸린 평균 시간 (ms) — 해소된 것만, 없으면 null */
  meanTimeToResolveMs: number | null;
}

/**
 * 이력 요약 — "무엇이 자주 나고, 얼마나 오래 걸려 풀리는가".
 *
 * 평균 해소 시간을 내는 이유: 경보가 많은 것보다 **오래 방치되는 것**이
 * 더 나쁜 신호다. 건수만 세면 그게 안 보인다.
 */
export function summarizeHistory(entries: HistoryEntry[]): HistorySummary {
  const byKind = new Map<string, { alerts: number; occurrences: number }>();
  let resolveTotal = 0;
  let resolveCount = 0;

  for (const entry of entries) {
    const current = byKind.get(entry.kind) ?? { alerts: 0, occurrences: 0 };
    current.alerts += 1;
    current.occurrences += entry.occurrences;
    byKind.set(entry.kind, current);

    if (entry.resolvedAt !== null && entry.resolvedAt >= entry.firstRaisedAt) {
      resolveTotal += entry.resolvedAt - entry.firstRaisedAt;
      resolveCount += 1;
    }
  }

  return {
    total: entries.length,
    active: entries.filter((entry) => entry.status === "ACTIVE").length,
    resolved: entries.filter((entry) => entry.status === "RESOLVED").length,
    archived: entries.filter((entry) => entry.status === "ARCHIVED").length,
    byKind: [...byKind.entries()]
      .map(([kind, value]) => ({ kind, ...value }))
      .sort((a, b) => b.occurrences - a.occurrences || a.kind.localeCompare(b.kind)),
    meanTimeToResolveMs:
      resolveCount > 0 ? Math.round(resolveTotal / resolveCount) : null,
  };
}

/**
 * Governance Preflight Scan. (TASK-2601, Sprint 26 — CTO 결정 2501-①)
 *
 * **위반 목록만 만든다. 상태를 바꾸지 않고, 자동으로 고치지 않는다.**
 *
 * TASK-2501에서 발행 게이트를 켰다. 그런데 규칙을 처음 켜는 순간 이미
 * `REVIEW`에 있던 콘텐츠들이 위반을 담고 있을 수 있고, 그러면 **발행이
 * 줄줄이 막힌다** — 하나씩 눌러 보며 발견하는 방식으로는 언제 끝날지 알 수
 * 없다. 켜기 전에 무엇이 막힐지 세어 보는 것이 이 스캔이다.
 *
 * **자동 수정을 하지 않는 이유**는 원격 사본 자동 복구를 만들지 않은 것
 * (CTO 결정 2201-②)과 같다: 금지어를 기계가 지우면 문장이 무슨 뜻이 되는지
 * 아무도 확인하지 않은 채 발행된다. 고지 문구를 기계가 덧붙이면 맥락과
 * 무관한 자리에 붙는다. **무엇이 잘못됐는지 말하고 사람이 고치게 한다.**
 *
 * 이미 발행된 것과 아직 발행되지 않은 것을 **나누어 센다.** 성질이 다르다:
 * - 아직 발행 안 된 위반 → 발행 시 **막힌다.** 고치면 된다.
 * - 이미 발행된 위반 → **이미 나갔다.** 막을 수 없고, 사람이 내려야 한다.
 */

import type { ContentStatus } from "@acos/shared";
import type { GovernanceStatus } from "./content-governance";

/** 스캔 한 건의 결과 — 판정은 `evaluateContentGovernance`가 이미 했다 */
export interface PreflightItem {
  contentId: string;
  projectId: string;
  title: string;
  contentStatus: ContentStatus;
  status: GovernanceStatus;
  /** 발행을 막는 검사의 key — 비어 있으면 막히지 않는다 */
  blockedBy: string[];
  /** 막지는 않지만 드러낼 것 */
  warnings: string[];
}

/** 검사별 위반 집계 */
export interface PreflightByCheck {
  key: string;
  /** 이 검사 때문에 막히는 콘텐츠 수 */
  blocked: number;
  /** 이 검사가 주의인 콘텐츠 수 */
  warned: number;
}

export interface PreflightSummary {
  /** 실제로 판정한 콘텐츠 수 */
  scanned: number;
  /**
   * 아직 발행되지 않았고 위반이 있는 것 — **발행 시 막힌다.**
   * 규칙을 켜기 전에 이 숫자를 보는 것이 이 스캔의 목적이다.
   */
  blocked: number;
  /**
   * **이미 발행됐는데 위반이 있는 것.**
   *
   * 따로 세는 이유: 막을 수 없다. 발행 게이트는 나가는 것을 막지만
   * 이미 나간 것에는 아무 힘이 없다 — 사람이 내려야 한다.
   */
  publishedViolations: number;
  /** 막지는 않지만 주의가 있는 것 */
  warned: number;
  /** 이상 없는 것 */
  clean: number;
  /** 검사별 집계 — 무엇을 먼저 고칠지 판단하는 근거 */
  byCheck: PreflightByCheck[];
}

export interface PreflightResult {
  summary: PreflightSummary;
  /** 위반이 있는 것만, 심한 것부터 */
  items: PreflightItem[];
  /**
   * 결과를 잘랐는가.
   *
   * **조용히 자르지 않는다** — 100건만 보여 주면서 "위반 100건"이라고 하면
   * 실제로 몇 건인지 아무도 모른다. 요약의 숫자는 **자르기 전 전체**다.
   */
  truncated: boolean;
  /** 잘려서 목록에 담기지 않은 건수 */
  omitted: number;
}

/** 이 상태의 콘텐츠는 이미 세상에 나갔다 */
export function isReleased(status: ContentStatus): boolean {
  return status === "PUBLISHED";
}

const SEVERITY: Record<GovernanceStatus, number> = {
  FAIL: 0,
  WARNING: 1,
  PASS: 2,
};

/**
 * 스캔 결과 요약 (순수 함수).
 *
 * `limit`은 **목록만** 자른다 — 요약의 숫자는 전체를 센다. 그래야 "위반
 * 3건"과 "위반 300건 중 3건 표시"를 구분할 수 있다.
 */
export function summarizePreflight(
  items: PreflightItem[],
  options: { limit?: number } = {},
): PreflightResult {
  const byCheck = new Map<string, { blocked: number; warned: number }>();
  let blocked = 0;
  let publishedViolations = 0;
  let warned = 0;
  let clean = 0;

  for (const item of items) {
    const hasBlockers = item.blockedBy.length > 0;
    if (hasBlockers) {
      // 이미 나간 것과 아직 막을 수 있는 것을 섞어 세지 않는다
      if (isReleased(item.contentStatus)) {
        publishedViolations += 1;
      } else {
        blocked += 1;
      }
    } else if (item.warnings.length > 0) {
      warned += 1;
    } else {
      clean += 1;
    }

    for (const key of item.blockedBy) {
      const current = byCheck.get(key) ?? { blocked: 0, warned: 0 };
      current.blocked += 1;
      byCheck.set(key, current);
    }
    for (const key of item.warnings) {
      const current = byCheck.get(key) ?? { blocked: 0, warned: 0 };
      current.warned += 1;
      byCheck.set(key, current);
    }
  }

  // 위반이 있는 것만 담고, 심한 것부터 — 통과한 것을 목록에 넣으면
  // 정작 고쳐야 할 것이 묻힌다
  const violations = items
    .filter(
      (item) => item.blockedBy.length > 0 || item.warnings.length > 0,
    )
    .sort(
      (a, b) =>
        SEVERITY[a.status] - SEVERITY[b.status] ||
        // 이미 나간 것을 먼저 — 막을 수 없는 것이 더 급하다
        Number(isReleased(b.contentStatus)) -
          Number(isReleased(a.contentStatus)) ||
        b.blockedBy.length - a.blockedBy.length ||
        a.contentId.localeCompare(b.contentId),
    );

  const limit = options.limit;
  const shown =
    typeof limit === "number" && limit >= 0
      ? violations.slice(0, limit)
      : violations;

  return {
    summary: {
      scanned: items.length,
      blocked,
      publishedViolations,
      warned,
      clean,
      byCheck: [...byCheck.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort(
          (a, b) =>
            b.blocked - a.blocked ||
            b.warned - a.warned ||
            a.key.localeCompare(b.key),
        ),
    },
    items: shown,
    truncated: shown.length < violations.length,
    omitted: violations.length - shown.length,
  };
}

/**
 * 스캔 결과를 사람이 읽을 한 줄로.
 *
 * 숫자만 있으면 무엇을 해야 할지 알 수 없으므로, **이미 나간 위반이 있으면
 * 그것을 먼저 말한다** — 막을 수 없는 것이 더 급하다.
 */
export function describePreflight(result: PreflightResult): string {
  const { summary } = result;
  if (summary.scanned === 0) {
    return "검사할 콘텐츠가 없습니다.";
  }

  const parts: string[] = [];
  if (summary.publishedViolations > 0) {
    parts.push(
      `이미 발행된 위반 ${summary.publishedViolations}건 (막을 수 없습니다 — 내려야 합니다)`,
    );
  }
  if (summary.blocked > 0) {
    parts.push(`발행이 막힐 것 ${summary.blocked}건`);
  }
  if (summary.warned > 0) {
    parts.push(`주의 ${summary.warned}건`);
  }
  if (parts.length === 0) {
    return `콘텐츠 ${summary.scanned}건 검사 — 위반 없음.`;
  }

  const tail = result.truncated
    ? ` 목록에는 ${result.items.length}건만 담았습니다 (${result.omitted}건 생략).`
    : "";
  return (
    `콘텐츠 ${summary.scanned}건 검사 — ${parts.join(" · ")}.` +
    " 이 스캔은 상태를 바꾸지 않고 고치지도 않습니다." +
    tail
  );
}

// ── 판정 기록 보관 (CTO 결정 2501-⑤) ────────────────────────

/**
 * 판정 기록은 **삭제하지 않고 90일 이후 보관**한다 (CTO 결정 2501-⑤).
 *
 * 경보(결정 1302-④)·Dead Letter(결정 1501-③)와 같은 정책이다. 보관은
 * 현황 조회에서 비켜 두는 것이고, **삭제가 아니다** — 삭제는 되돌릴 수
 * 없고 "그때 왜 막혔나"를 확인할 방법을 영원히 없앤다.
 *
 * 경보와 다른 점: 경보는 **해소 시각**을 기준으로 세지만, 판정 기록은
 * 해소라는 개념이 없는 **시점 기록**이므로 **작성 시각**을 기준으로 센다.
 */
export const DEFAULT_GOVERNANCE_ARCHIVE_AFTER_DAYS = 90;

export const GOVERNANCE_ARCHIVE_AFTER_DAYS_ENV =
  "GOVERNANCE_ARCHIVE_AFTER_DAYS";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 보관 유예(일)를 환경에서 읽는다.
 *
 * 해석할 수 없거나 0 이하이면 기본값 — 잘못 적은 값 때문에 기록이 즉시
 * 보관되는 것보다 안전하다(경보 보관과 같은 판단).
 */
export function resolveGovernanceArchiveAfterDays(
  env: Record<string, string | undefined>,
): number {
  const raw = env[GOVERNANCE_ARCHIVE_AFTER_DAYS_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_GOVERNANCE_ARCHIVE_AFTER_DAYS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed)
    : DEFAULT_GOVERNANCE_ARCHIVE_AFTER_DAYS;
}

export interface GovernanceArchivePlan {
  /** 보관 기준 시각 — 이보다 전에 작성된 것이 대상 */
  cutoff: number;
  afterDays: number;
}

/** 보관 기준 시각을 계산한다 (순수 함수) */
export function planGovernanceArchive(options: {
  afterDays: number;
  now: number;
}): GovernanceArchivePlan {
  return {
    cutoff: options.now - options.afterDays * DAY_MS,
    afterDays: options.afterDays,
  };
}

/** 보관 결과 문구 — 보관과 삭제가 다르다는 것을 매번 밝힌다 */
export function describeGovernanceArchive(
  archived: number,
  afterDays: number,
): string {
  return (
    `발행 판정 기록 ${archived}건을 보관했습니다 (작성 후 ${afterDays}일 경과) — ` +
    "삭제하지 않습니다."
  );
}

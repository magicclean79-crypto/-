import Link from "next/link";
import type {
  GovernancePreflightDto,
  GovernanceScanRunDto,
  GovernanceStatusDto,
} from "@acos/shared";

const STATUS_STYLE: Record<GovernanceStatusDto, string> = {
  PASS: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  WARNING: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  FAIL: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const CHECK_LABEL: Record<string, string> = {
  "content-body": "제목·본문",
  "banned-words": "금지어 검사",
  disclosures: "필수 고지",
  "source-object": "근거 상품 연결",
  "related-rules": "관련 규칙 검토",
};

/**
 * Governance Preflight Scan 패널 (TASK-2601, CTO 결정 2501-①).
 *
 * **상태를 바꾸지 않고, 고치지도 않는다.** 그래서 이 패널에는 버튼이 없다 —
 * "한 번에 고치기"가 있으면 누군가는 누르고, 기계가 지운 문장이 무슨 뜻이
 * 되는지 아무도 확인하지 않은 채 발행된다.
 *
 * 이미 나간 위반을 **맨 위에 따로** 보여준다. 성질이 다르다: 발행 게이트는
 * 나가는 것을 막지만 이미 나간 것에는 아무 힘이 없다.
 */
export function GovernancePreflightPanel({
  scan,
  projectId,
}: {
  scan: GovernancePreflightDto | null;
  projectId: string;
}) {
  if (!scan) {
    return (
      <p
        data-testid="preflight-unavailable"
        className="text-sm text-zinc-500"
      >
        발행 위반 스캔을 확인하지 못했습니다 — 위반이 없다는 뜻은 아닙니다.
      </p>
    );
  }

  const { summary } = scan;

  return (
    <div data-testid="governance-preflight" className="flex flex-col gap-3">
      <p data-testid="preflight-detail" className="text-sm text-zinc-600 dark:text-zinc-400">
        {scan.detail}
      </p>

      {summary.publishedViolations > 0 ? (
        <p
          data-testid="preflight-released"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          이미 발행된 위반 {summary.publishedViolations}건 — 발행 게이트로는
          막을 수 없습니다. 내리거나 고쳐 다시 발행해야 합니다.
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        {[
          { label: "검사", value: summary.scanned, testId: "preflight-scanned" },
          { label: "발행 차단될 것", value: summary.blocked, testId: "preflight-blocked" },
          {
            label: "이미 발행된 위반",
            value: summary.publishedViolations,
            testId: "preflight-published",
          },
          { label: "주의", value: summary.warned, testId: "preflight-warned" },
          { label: "이상 없음", value: summary.clean, testId: "preflight-clean" },
        ].map((entry) => (
          <div
            key={entry.label}
            data-testid={entry.testId}
            className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
          >
            <dt className="text-zinc-500">{entry.label}</dt>
            <dd className="mt-0.5 font-mono text-base">{entry.value}</dd>
          </div>
        ))}
      </dl>

      {summary.byCheck.length > 0 ? (
        <ul data-testid="preflight-by-check" className="flex flex-wrap gap-2 text-xs">
          {summary.byCheck.map((entry) => (
            <li
              key={entry.key}
              className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800"
            >
              {CHECK_LABEL[entry.key] ?? entry.key} · 차단 {entry.blocked} ·
              주의 {entry.warned}
            </li>
          ))}
        </ul>
      ) : null}

      {scan.page.total > scan.items.length || scan.page.offset > 0 ? (
        <div
          data-testid="preflight-page"
          className="flex flex-wrap items-center gap-3 text-xs text-zinc-500"
        >
          <span>
            위반 {scan.page.total}건 중{" "}
            {scan.items.length > 0
              ? `${scan.page.offset + 1}~${scan.page.offset + scan.items.length}`
              : "0"}
            번째
          </span>
          {scan.page.offset > 0 ? (
            <Link
              data-testid="preflight-prev"
              href={`/projects/${projectId}?violations=${Math.max(0, scan.page.offset - scan.page.limit)}`}
              className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              이전
            </Link>
          ) : null}
          {scan.page.hasMore ? (
            <Link
              data-testid="preflight-next"
              href={`/projects/${projectId}?violations=${scan.page.offset + scan.page.limit}`}
              className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              다음
            </Link>
          ) : null}
        </div>
      ) : null}

      {scan.items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {scan.items.map((item) => (
            <li
              key={item.contentId}
              data-testid="preflight-item"
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 ${STATUS_STYLE[item.status]}`}
              >
                {item.status === "FAIL" ? "실패" : item.status === "WARNING" ? "주의" : "통과"}
              </span>
              {/* 이미 나간 것은 글자로 밝힌다 — 색만으로는 구분되지 않는다 */}
              {item.contentStatus === "PUBLISHED" ? (
                <span className="shrink-0 font-medium text-red-600 dark:text-red-400">
                  이미 발행됨
                </span>
              ) : null}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {item.title}
              </span>
              <span className="text-zinc-500">
                {item.blockedBy.length > 0
                  ? `차단: ${item.blockedBy.map((key) => CHECK_LABEL[key] ?? key).join(", ")}`
                  : `주의: ${item.warnings.map((key) => CHECK_LABEL[key] ?? key).join(", ")}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const VERDICT_LABEL: Record<GovernanceScanRunDto["verdict"], string> = {
  baseline: "기준선",
  increased: "늘었음",
  decreased: "줄었음",
  unchanged: "변화 없음",
  resolved: "해소",
};

/**
 * 예약 스캔 이력 (TASK-2701, CTO 결정 2601-②③).
 *
 * **경보를 만들지 않은 실행도 보여준다** — "돌았지만 조용했다"와 "돌지
 * 않았다"는 다르고, 그 구분이 없으면 예약이 멈춘 것을 알아챌 수 없다.
 */
export function GovernanceScanHistory({
  runs,
}: {
  runs: GovernanceScanRunDto[];
}) {
  if (runs.length === 0) {
    return (
      <p data-testid="scan-history-empty" className="text-sm text-zinc-500">
        예약 스캔이 아직 돌지 않았습니다 — 위반이 없다는 뜻은 아닙니다.
      </p>
    );
  }

  return (
    <ul data-testid="scan-history" className="flex flex-col gap-1">
      {runs.map((run) => (
        <li
          key={run.id}
          data-testid="scan-run"
          className="flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="font-mono text-zinc-400">
            {run.createdAt.slice(0, 16).replace("T", " ")}
          </span>
          <span className="rounded-full border border-zinc-200 px-2 py-0.5 dark:border-zinc-800">
            {VERDICT_LABEL[run.verdict]}
          </span>
          <span className="text-zinc-600 dark:text-zinc-400">
            위반 {run.total}건
            {run.previousTotal !== null ? ` (지난번 ${run.previousTotal}건)` : ""}
          </span>
          {/* 경보를 냈는지 글자로 밝힌다 — 조용한 것과 안 돈 것은 다르다 */}
          <span
            className={
              run.alerted
                ? "font-medium text-red-600 dark:text-red-400"
                : "text-zinc-400"
            }
          >
            {run.alerted ? "경보" : "조용"}
          </span>
          <span className="text-zinc-500">{run.trigger}</span>
        </li>
      ))}
    </ul>
  );
}

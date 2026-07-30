import type {
  ContentGovernanceDto,
  GovernanceStatusDto,
} from "@acos/shared";

const STATUS_STYLE: Record<GovernanceStatusDto, string> = {
  PASS: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  WARNING: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  FAIL: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_LABEL: Record<GovernanceStatusDto, string> = {
  PASS: "통과",
  WARNING: "주의",
  FAIL: "실패",
};

/**
 * 발행 거버넌스 판정 패널 (TASK-2501).
 *
 * 발행 버튼 **옆에** 둔다 — 눌러 보고 막히는 것과, 무엇이 막는지 먼저 보는
 * 것은 다르다. 판정은 발행 게이트와 같은 함수에서 나오므로 여기서
 * "발행 가능"이면 눌러도 막히지 않는다.
 *
 * 주의와 차단을 **글자로** 구분한다. 색만으로 구분하면 색을 못 보는 사람에게는
 * 같은 화면이다.
 */
export function ContentGovernancePanel({
  verdict,
}: {
  verdict: ContentGovernanceDto | null;
}) {
  if (!verdict) {
    return (
      <p
        data-testid="governance-unavailable"
        className="mt-3 border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800"
      >
        발행 거버넌스 판정을 확인하지 못했습니다 — 통과한 것이 아닙니다.
      </p>
    );
  }

  return (
    <div
      data-testid="content-governance"
      className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          발행 거버넌스
        </p>
        <span
          data-testid="governance-status"
          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[verdict.status]}`}
        >
          {STATUS_LABEL[verdict.status]}
        </span>
        <span
          data-testid="governance-verdict"
          className={`text-xs ${
            verdict.publishable
              ? "text-zinc-500"
              : "font-medium text-red-600 dark:text-red-400"
          }`}
        >
          {verdict.publishable ? "발행 가능" : "발행 차단"}
        </span>
        <span className="text-xs text-zinc-400">
          기준: 금지어{" "}
          {verdict.appliedRules.bannedWordCount === null
            ? "확인 불가"
            : `${verdict.appliedRules.bannedWordCount}개`}{" "}
          · 적용 고지{" "}
          {verdict.appliedRules.disclosureIds === null
            ? "확인 불가"
            : `${verdict.appliedRules.disclosureIds.length}건`}
        </span>
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {verdict.checks.map((check) => (
          <li
            key={check.key}
            data-testid="governance-check"
            className="flex flex-wrap items-start gap-2 text-xs"
          >
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 ${STATUS_STYLE[check.status]}`}
            >
              {STATUS_LABEL[check.status]}
            </span>
            <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">
              {check.name}
            </span>
            {/* 막는 항목임을 글자로 밝힌다 — "주의인데 왜 막혔지"를 없앤다 */}
            {check.blocking && check.status === "FAIL" ? (
              <span className="shrink-0 text-red-600 dark:text-red-400">
                발행 차단
              </span>
            ) : null}
            <span className="text-zinc-500">{check.messages.join(" ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

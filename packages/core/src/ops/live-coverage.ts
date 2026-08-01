/**
 * 라이브 검증의 CI 적용 범위. (TASK-4701, Sprint 47 — 지시 4)
 *
 * ## 왜 이 파일이 판정이어야 하는가
 *
 * "CI에서 어디까지 할 수 있는가"는 지금까지 **문서의 문장**이었습니다.
 * 문장은 코드가 바뀌어도 그대로 남습니다 — 검사를 하나 추가한 사람이 그
 * 문장을 고치지 않으면, 문서는 **틀렸는데 아무도 모르는 상태**가 됩니다.
 *
 * 그래서 검사 목록과 각 검사가 **무엇을 필요로 하는지**를 값으로 두고,
 * "CI에서 되는가"를 계산합니다. 검사를 추가하면 필요한 것을 적어야 하고,
 * 적으면 이 판정이 자동으로 갱신됩니다.
 *
 * ## CI에서 도는 것은 라이브 검증이 아닙니다
 *
 * 가장 중요한 문장을 먼저 둡니다. Postgres 서비스 컨테이너와 우리 스텁을
 * 상대로 도는 검사는 **배선이 맞는지**를 증명합니다. 그것은
 * **실제 Provider가 우리 요청을 어떻게 대하는지**를 증명하지 않습니다.
 *
 * 두 가지를 같은 이름으로 부르면, 어느 날 CI가 초록인 것을 보고
 * "라이브 검증이 끝났다"고 말하게 됩니다. 그건 TASK-3501에서 이미 한 번
 * 저지를 뻔한 사고입니다(스텁 상대 성공 기록을 "연결됨"으로 셀 뻔했습니다).
 */

/** 검사 하나가 필요로 하는 것 */
export type LiveNeed =
  /** 실 PostgreSQL */
  | "postgres"
  /** 실 Redis */
  | "redis"
  /** 실 객체 저장소 (S3 호환) */
  | "object-storage"
  /** 실 브라우저 */
  | "browser"
  /** 우리가 띄우는 스텁 서버 */
  | "local-stub"
  /** 실 Provider 자격 증명 */
  | "provider-credentials"
  /** **돈이 나가는 호출** */
  | "paid-call"
  /** 우리 통제 밖 네트워크 */
  | "external-network"
  /** 사람이 눈으로 봐야 하는 것 */
  | "human-eyes";

/**
 * CI 러너에서 마련할 수 있는 것.
 *
 * 자격 증명·과금 호출·사람 눈은 **여기에 없습니다.** 넣을 수 있는지 없는지의
 * 문제가 아니라, 넣으면 안 되는 것들입니다 — 매 푸시마다 남의 서비스에 돈이
 * 나가는 테스트가 도는 상태는 게이트가 아니라 사고입니다.
 */
export const CI_AVAILABLE_NEEDS: readonly LiveNeed[] = [
  "postgres",
  "redis",
  "object-storage",
  "browser",
  "local-stub",
];

export interface LiveCheck {
  id: string;
  title: string;
  needs: LiveNeed[];
  /** 이 검사가 무엇을 증명하는가 */
  proves: string;
}

export type CoverageVerdict = "ci" | "human-only";

export interface LiveCheckCoverage extends LiveCheck {
  verdict: CoverageVerdict;
  /** CI에서 못 도는 이유 — 돌 수 있으면 빈 배열 */
  blockedBy: LiveNeed[];
  reason: string;
}

export interface LiveCoverageReport {
  checks: LiveCheckCoverage[];
  ciCount: number;
  humanCount: number;
  /** 몇 %가 CI에서 도는가 — **소수점 없이, 올림 없이** */
  ciPercent: number;
  summary: string;
  /** 절대 잊으면 안 되는 문장 */
  caveat: string;
}

/** 필요한 것들의 사람 말 */
const NEED_LABEL: Record<LiveNeed, string> = {
  postgres: "실 PostgreSQL",
  redis: "실 Redis",
  "object-storage": "실 객체 저장소",
  browser: "실 브라우저",
  "local-stub": "우리 스텁",
  "provider-credentials": "실 Provider 자격 증명",
  "paid-call": "돈이 나가는 호출",
  "external-network": "통제 밖 네트워크",
  "human-eyes": "사람 눈",
};

/**
 * 라이브 검사 목록 — **여기가 사실의 출처입니다.**
 *
 * 새 검사를 만들면 여기에 적습니다. 적지 않으면 이 판정은 그 검사를
 * 세지 않고, 세지 않은 것은 "CI 적용률"을 실제보다 좋게 보이게 합니다.
 */
export const LIVE_CHECKS: LiveCheck[] = [
  {
    id: "job-batch-succeeds",
    title: "묶음 작업이 끝까지 돈다",
    needs: ["postgres", "local-stub"],
    proves: "실행기·체크포인트·계측이 실제 DB를 상대로 동작한다",
  },
  {
    id: "job-checkpoint-saves-money",
    title: "끝난 단계를 다시 사지 않는다",
    needs: ["postgres", "local-stub"],
    proves: "이어하기가 이미 끝난 단계를 건너뛴다",
  },
  {
    id: "job-resume-same-row",
    title: "이어하기가 같은 행에 쓴다",
    needs: ["postgres", "local-stub"],
    proves: "앞의 시도가 없던 일이 되지 않는다",
  },
  {
    id: "job-provider-down-stops",
    title: "상대가 죽으면 배치를 멈춘다",
    needs: ["postgres", "local-stub"],
    proves: "공통 원인을 한 건의 문제로 보지 않는다",
  },
  {
    id: "job-blocked-not-retried",
    title: "정책으로 막은 것은 재시도하지 않는다",
    needs: ["postgres", "local-stub"],
    proves: "예산 초과를 호출 제한으로 읽지 않는다",
  },
  {
    id: "auto-resume-orphan",
    title: "죽은 프로세스가 남긴 작업을 이어한다",
    needs: ["postgres"],
    proves: "심장박동이 멈춘 작업을 큐가 되살린다",
  },
  {
    id: "auto-resume-holds-blocked",
    title: "고칠 수 없는 실패는 자동으로 안 돌린다",
    needs: ["postgres"],
    proves: "아무도 안 보는 사이에 같은 실패를 반복하지 않는다",
  },
  {
    id: "token-detail-recorded",
    title: "캐시·생각 토큰이 기록된다",
    needs: ["postgres", "local-stub"],
    proves: "비용 계산이 캐시를 반영한다",
  },
  {
    id: "cost-of-a-job",
    title: "작업 하나의 비용이 나온다",
    needs: ["postgres", "local-stub"],
    proves: "단계별 토큰이 비용으로 이어진다",
  },
  {
    id: "existing-responses-unchanged",
    title: "기존 응답이 그대로다",
    needs: ["postgres", "local-stub"],
    proves: "새 층이 옛 계약을 건드리지 않았다",
  },
  {
    id: "logs-have-no-secrets",
    title: "로그에 비밀이 없다",
    needs: ["postgres"],
    proves: "가림이 실제 기록에서 동작한다",
  },
  {
    id: "screen-reads-right",
    title: "화면 문장이 사실과 맞는다",
    needs: ["browser", "postgres", "local-stub", "human-eyes"],
    proves: "요약과 칸이 같은 말을 한다 — 이건 사람이 읽어야 안다",
  },
  {
    id: "real-provider-call",
    title: "실 Provider가 우리 요청을 받는다",
    needs: ["provider-credentials", "paid-call", "external-network"],
    proves: "스텁이 아니라 진짜 상대가 우리를 받아 준다",
  },
  {
    id: "real-provider-usage",
    title: "실 Provider가 주는 usage가 우리 가정과 같다",
    needs: ["provider-credentials", "paid-call", "external-network"],
    proves: "캐시·생각 토큰의 의미가 문서대로다 — 이건 우리가 확인할 수 없습니다",
  },
  {
    id: "real-storage-durability",
    title: "운영 저장소가 실제로 보관한다",
    needs: ["object-storage", "external-network"],
    proves: "s3rver가 아니라 운영 저장소가 받는다",
  },
];

/**
 * 어떤 검사가 CI에서 돌 수 있는지 판정한다 (순수 함수).
 *
 * **비율을 올림하지 않습니다.** 87.5%를 88%로 올리면 그 0.5%는 영영
 * 돌아오지 않는 검사인데 숫자로는 이미 있는 것처럼 보입니다.
 */
export function judgeCiCoverage(
  checks: LiveCheck[] = LIVE_CHECKS,
  available: readonly LiveNeed[] = CI_AVAILABLE_NEEDS,
): LiveCoverageReport {
  const allowed = new Set(available);

  const covered: LiveCheckCoverage[] = checks.map((check) => {
    const blockedBy = check.needs.filter((need) => !allowed.has(need));
    if (blockedBy.length === 0) {
      return {
        ...check,
        verdict: "ci",
        blockedBy: [],
        reason: "러너에서 마련할 수 있는 것만 필요합니다.",
      };
    }
    return {
      ...check,
      verdict: "human-only",
      blockedBy,
      reason: `${blockedBy.map((need) => NEED_LABEL[need]).join(" · ")}이(가) 필요합니다 — CI에 둘 수 없습니다.`,
    };
  });

  const ciCount = covered.filter((row) => row.verdict === "ci").length;
  const humanCount = covered.length - ciCount;
  const ciPercent =
    covered.length === 0 ? 0 : Math.floor((ciCount / covered.length) * 100);

  return {
    checks: covered,
    ciCount,
    humanCount,
    ciPercent,
    summary:
      `라이브 검사 ${covered.length}건 중 ${ciCount}건이 CI에서 돌 수 있고 ` +
      `${humanCount}건은 사람이 돌려야 합니다 (${ciPercent}%).`,
    caveat:
      "CI에서 도는 검사는 배선이 맞는지를 증명합니다 — 실제 Provider가 " +
      "우리 요청을 어떻게 대하는지는 증명하지 않습니다. CI가 초록이라고 " +
      "라이브 검증이 끝난 것이 아닙니다.",
  };
}

/** 사람만 할 수 있는 검사와 그 이유 — 보고서에 그대로 싣는다 */
export function humanOnlyChecks(
  report: LiveCoverageReport = judgeCiCoverage(),
): { title: string; blockedBy: string; proves: string }[] {
  return report.checks
    .filter((check) => check.verdict === "human-only")
    .map((check) => ({
      title: check.title,
      blockedBy: check.blockedBy.map((need) => NEED_LABEL[need]).join(" · "),
      proves: check.proves,
    }));
}

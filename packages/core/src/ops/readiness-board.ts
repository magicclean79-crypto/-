/**
 * Production Readiness Dashboard. (TASK-4301, Sprint 43 — CTO 정책 4301-④)
 *
 * 지금 운영 상태를 알려면 화면 다섯 개를 열어야 합니다: 활성화 조건 ·
 * 전환 검증 · 진단 · 준비 단계 · 비용. 각각은 정확한데, **한 번에 볼 수
 * 없어서** 실제로는 아무도 다 보지 않습니다.
 *
 * ## 이 파일이 하지 않는 일: 새로 판정하는 것
 *
 * 대시보드를 만들 때 가장 하기 쉬운 실수는 **자기만의 점수를 계산하는
 * 것**입니다. 그러면 같은 사실에 대해 두 개의 답이 생기고, 둘이 어긋나는
 * 순간 사람은 둘 다 안 믿습니다. TASK-4101 라이브 검증에서 우리가 실제로
 * 겪은 결함이 정확히 그 모양이었습니다 — 준비 판정은 "검증용 환경 확보
 * 완료"라고 하고, 보호 판정은 같은 순간 "운영을 가리킵니다"라고 했습니다.
 *
 * 그래서 이 판정기는 **인용만 합니다.** 각 칸은 어느 판정에서 온 값인지
 * (`source`)를 달고 다니고, 여기서 상태를 다시 계산하지 않습니다. 진행률도
 * **준비 단계 판정의 분모를 그대로** 씁니다 — 우리가 분모를 새로 고르는
 * 순간 그 숫자는 우리에게 유리한 쪽으로 정해집니다.
 *
 * ## 회색을 초록 옆에 두지 않습니다
 *
 * `unknown`은 "아직 모른다"이지 "괜찮다"가 아닙니다. 대시보드에서 이 둘이
 * 비슷하게 보이면, 모르는 항목이 많은 환경이 건강해 보입니다.
 */

export type BoardStatus = "ok" | "warn" | "fail" | "unknown" | "blocked";

export interface BoardTile {
  id: string;
  title: string;
  status: BoardStatus;
  /** 한 줄 요약 — 판정이 한 말을 그대로 쓴다 */
  detail: string;
  /** 이 값을 말한 판정 (엔드포인트) — 어긋나면 숨길 수 없게 */
  source: string;
  /** 사람이 다음에 할 일 — 없으면 null */
  next: string | null;
}

export interface ReadinessBoard {
  tiles: BoardTile[];
  /** 준비 단계 판정에서 그대로 가져온 값 */
  steps: { done: number; total: number };
  /** 검증 스프린트를 시작할 수 있는가 — 준비 판정의 값을 그대로 쓴다 */
  readiness: "ready" | "blocked" | "not-ready" | "unknown";
  /** 지금 무엇이 막고 있는가 — 사람 몫 먼저 */
  blockers: BoardTile[];
  /** 확인하지 못한 칸 — **초록으로 세지 않는다** */
  unknowns: BoardTile[];
  fail: number;
  warn: number;
  detail: string;
  checkedAt: string;
}

/**
 * 이미 나온 판정들을 한 화면으로 모은다 (순수 함수, CTO 정책 4301-④).
 *
 * 각 입력이 `null`이면 그 칸은 `unknown`입니다 — **못 본 것을 통과로 세지
 * 않습니다.**
 */
export function buildReadinessBoard(input: {
  /** 준비 단계 판정 (`GET /ops/validation-plan`) */
  plan: {
    readiness: "ready" | "blocked" | "not-ready";
    done: number;
    total: number;
    waitingOnPeople: { title: string }[];
    waitingOnUs: { title: string }[];
    detail: string;
  } | null;
  /** 실행 잠금 (`GET /ops/validation-run`) */
  runGate: { allowed: boolean; reasons: string[] } | null;
  /** 기동·일일 진단 (`GET /ops/diagnostics`) */
  diagnostics: { fail: number; warn: number; unknown: number; detail: string } | null;
  /** 전환 검증 (`GET /ops/cutover`) */
  cutover: { verified: number; total: number; notProduction: number } | null;
  /** 운영 호스트 목록 (`GET /ops/hosts`) */
  hosts: { declared: number; undeclared: number; detail: string } | null;
  /** 방치 (`GET /ops/neglect`) */
  neglect: {
    neglected: number;
    ignored: number;
    overdue: number;
    worstLabel: string | null;
  } | null;
  /** 프로젝트 비용 귀속 (`GET /ops/cost/projects`) */
  attribution: {
    coverage: number | null;
    recentCoverage: number | null;
    minCoverage: number;
  } | null;
  /** 운영 활성화 런북 (`GET /ops/runbook`) */
  runbook: { done: number; total: number; nextTitle: string | null; detail: string } | null;
  /** 배포 단계 */
  tier: string;
  checkedAt: string;
}): ReadinessBoard {
  const tiles: BoardTile[] = [];

  tiles.push(
    input.plan === null
      ? unknownTile("validation-plan", "검증 준비 단계", "GET /ops/validation-plan")
      : {
          id: "validation-plan",
          title: "검증 준비 단계",
          // 준비 판정의 결론을 **그대로** 옮긴다 — 여기서 다시 계산하지 않는다
          status:
            input.plan.readiness === "ready"
              ? "ok"
              : input.plan.readiness === "blocked"
                ? "blocked"
                : "warn",
          detail: input.plan.detail,
          source: "GET /ops/validation-plan",
          next:
            input.plan.waitingOnPeople.length > 0
              ? `사람이 줘야 끝나는 단계: ${input.plan.waitingOnPeople
                  .map((step) => step.title)
                  .join(" · ")}`
              : input.plan.waitingOnUs.length > 0
                ? `우리 쪽에 남은 단계: ${input.plan.waitingOnUs
                    .map((step) => step.title)
                    .join(" · ")}`
                : null,
        },
  );

  tiles.push(
    input.runGate === null
      ? unknownTile("validation-run", "검증 실행 잠금", "GET /ops/validation-run")
      : {
          id: "validation-run",
          title: "검증 실행 잠금",
          status: input.runGate.allowed ? "ok" : "blocked",
          detail: input.runGate.allowed
            ? "검증을 시작할 수 있습니다."
            : `${input.runGate.reasons.length}가지 이유로 막혀 있습니다: ${input.runGate.reasons.join(" / ")}`,
          source: "GET /ops/validation-run",
          next: input.runGate.allowed
            ? null
            : "강제로 여는 방법은 없습니다 — 막는 조건을 없애야 합니다.",
        },
  );

  tiles.push(
    input.diagnostics === null
      ? unknownTile("diagnostics", "운영 진단", "GET /ops/diagnostics")
      : {
          id: "diagnostics",
          title: "운영 진단",
          status:
            input.diagnostics.fail > 0
              ? "fail"
              : input.diagnostics.unknown > 0
                ? // **모르는 것이 있으면 초록이 아니다**
                  "unknown"
                : input.diagnostics.warn > 0
                  ? "warn"
                  : "ok",
          detail: input.diagnostics.detail,
          source: "GET /ops/diagnostics",
          next:
            input.diagnostics.fail > 0
              ? "실패한 항목을 먼저 보세요."
              : input.diagnostics.unknown > 0
                ? "확인하지 못한 항목이 있습니다 — 통과가 아닙니다."
                : null,
        },
  );

  tiles.push(
    input.cutover === null
      ? unknownTile("cutover", "실 Provider 전환", "GET /ops/cutover")
      : {
          id: "cutover",
          title: "실 Provider 전환",
          status:
            input.cutover.notProduction > 0
              ? "fail"
              : input.cutover.verified === input.cutover.total &&
                  input.cutover.total > 0
                ? "ok"
                : "warn",
          detail:
            `전환 검증 ${input.cutover.verified}/${input.cutover.total} · ` +
            `공식 주소가 아닌 대상 ${input.cutover.notProduction}건.`,
          source: "GET /ops/cutover",
          next:
            input.cutover.verified === input.cutover.total && input.cutover.total > 0
              ? null
              : "스텁 성공은 연결 확인이 아닙니다 — 실 자격 증명이 필요합니다.",
        },
  );

  tiles.push(
    input.hosts === null
      ? unknownTile("hosts", "운영 호스트 목록", "GET /ops/hosts")
      : {
          id: "hosts",
          title: "운영 호스트 목록",
          status:
            input.hosts.declared === 0
              ? "fail"
              : input.hosts.undeclared > 0
                ? "warn"
                : "ok",
          detail: input.hosts.detail,
          source: "GET /ops/hosts",
          next:
            input.hosts.declared === 0
              ? "PRODUCTION_HOSTS가 비어 있으면 검증 대상 보호가 꺼진 것입니다."
              : input.hosts.undeclared > 0
                ? "목록에 없는 호스트가 운영인지 사람이 답해야 합니다."
                : null,
        },
  );

  tiles.push(
    input.neglect === null
      ? unknownTile("neglect", "방치", "GET /ops/neglect")
      : {
          id: "neglect",
          title: "방치",
          status:
            input.neglect.overdue > 0
              ? "warn"
              : input.neglect.neglected > input.neglect.ignored
                ? "warn"
                : "ok",
          detail:
            input.neglect.neglected === 0
              ? "기준을 넘게 그대로인 항목이 없습니다."
              : // **무시 중인 것을 빼서 말하지 않는다**
                `기준을 넘게 그대로인 항목 ${input.neglect.neglected}건 ` +
                `(무시 중 ${input.neglect.ignored}건 · 검토일 지남 ${input.neglect.overdue}건)` +
                (input.neglect.worstLabel === null
                  ? "."
                  : ` — 가장 오래된 것은 ${input.neglect.worstLabel}입니다.`),
          source: "GET /ops/neglect",
          next:
            input.neglect.overdue > 0
              ? "다시 보기로 한 날이 지난 항목이 있습니다."
              : null,
        },
  );

  tiles.push(
    input.attribution === null
      ? unknownTile("attribution", "비용 귀속", "GET /ops/cost/projects")
      : {
          id: "attribution",
          title: "비용 귀속",
          status:
            input.attribution.recentCoverage === null
              ? // 잴 수 없는 것은 초록이 아니다
                "unknown"
              : input.attribution.recentCoverage >= input.attribution.minCoverage
                ? "ok"
                : "warn",
          detail:
            input.attribution.recentCoverage === null
              ? "최근 창에 귀속 대상 호출이 없어 지금 들어오는 기록의 귀속률을 잴 수 없습니다."
              : `지금 들어오는 기록 ${input.attribution.recentCoverage}% · ` +
                `최근 창 전체 ${input.attribution.coverage ?? "-"}% — 옛 기록은 ` +
                "고칠 수 없으므로 전체는 천천히 따라옵니다.",
          source: "GET /ops/cost/projects",
          next:
            input.attribution.recentCoverage !== null &&
            input.attribution.recentCoverage < input.attribution.minCoverage
              ? "호출 경로에 프로젝트가 전달되는지 확인해 주세요."
              : null,
        },
  );

  tiles.push(
    input.runbook === null
      ? unknownTile("runbook", "운영 활성화 런북", "GET /ops/runbook")
      : {
          id: "runbook",
          title: "운영 활성화 런북",
          status:
            input.runbook.done === input.runbook.total && input.runbook.total > 0
              ? "ok"
              : "warn",
          detail: input.runbook.detail,
          source: "GET /ops/runbook",
          next:
            input.runbook.nextTitle === null
              ? null
              : `다음 단계: ${input.runbook.nextTitle}`,
        },
  );

  const unknowns = tiles.filter((tile) => tile.status === "unknown");
  const blockers = tiles.filter(
    (tile) => tile.status === "fail" || tile.status === "blocked",
  );
  const fail = tiles.filter((tile) => tile.status === "fail").length;
  const warn = tiles.filter((tile) => tile.status === "warn").length;

  const parts: string[] = [`[${input.tier}] 운영 준비 화면.`];
  if (input.plan === null) {
    parts.push("준비 단계 판정을 읽지 못했습니다 — 준비 상태를 말할 수 없습니다.");
  } else {
    parts.push(
      `준비 ${input.plan.done}/${input.plan.total} 단계 ` +
        `(${readinessLabel(input.plan.readiness)}).`,
    );
  }
  if (blockers.length > 0) {
    parts.push(`지금 막고 있는 것 ${blockers.length}가지: ${blockers.map((t) => t.title).join(" · ")}.`);
  }
  if (unknowns.length > 0) {
    parts.push(
      `확인하지 못한 칸 ${unknowns.length}개는 통과로 세지 않았습니다: ` +
        `${unknowns.map((t) => t.title).join(" · ")}.`,
    );
  }
  parts.push(
    "이 화면은 다른 판정을 인용만 합니다 — 여기서 다시 판정하면 같은 " +
      "사실에 두 개의 답이 생기고, 어긋나는 순간 둘 다 못 믿게 됩니다.",
  );

  return {
    tiles,
    steps: {
      done: input.plan?.done ?? 0,
      total: input.plan?.total ?? 0,
    },
    readiness: input.plan?.readiness ?? "unknown",
    blockers,
    unknowns,
    fail,
    warn,
    detail: parts.join(" "),
    checkedAt: input.checkedAt,
  };
}

function unknownTile(id: string, title: string, source: string): BoardTile {
  return {
    id,
    title,
    status: "unknown",
    // **못 봤다는 것을 못 봤다고 적는다** — 빈칸으로 두면 초록 옆에서
    // 조용한 칸이 되고, 조용한 칸은 괜찮은 칸으로 읽힌다
    detail: "이 판정을 읽지 못했습니다 — 괜찮다는 뜻이 아닙니다.",
    source,
    next: `${source}이 응답하는지 확인해 주세요.`,
  };
}

function readinessLabel(value: "ready" | "blocked" | "not-ready"): string {
  return value === "ready"
    ? "시작할 수 있음"
    : value === "blocked"
      ? "사람이 줄 것이 남음"
      : "우리 쪽 일이 남음";
}

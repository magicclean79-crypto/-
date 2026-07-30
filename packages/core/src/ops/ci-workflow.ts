/**
 * CI 워크플로 판정. (TASK-3401, Sprint 34 — CTO 지시 6 "GitHub Actions 운영 검증")
 *
 * ## 왜 파일과 실행을 함께 보는가
 *
 * 지금까지 CI는 **워크플로 파일에 게이트가 적혀 있는지**만 테스트로 고정해
 * 왔습니다(TASK-2201). 그런데 적혀 있는 것과 **초록으로 끝나는 것**은 다른
 * 사실입니다. 실제로 이 저장소의 GitHub Actions는 13회 실행이 **전부
 * 실패**했고, 그동안 우리는 로컬에서 게이트를 돌려 "전부 통과"라고 보고해
 * 왔습니다. 파일만 보면 알 수 없는 실패였습니다.
 *
 * 그래서 판정을 둘로 나눕니다:
 *
 * | 판정 | 무엇을 보는가 | 답하는 질문 |
 * | --- | --- | --- |
 * | `judgeCiWorkflow` | 워크플로 **파일** | 돌려야 할 게이트가 순서대로 있는가 |
 * | `judgeCiRuns` | 최근 **실행 결과** | 그 게이트가 실제로 초록인가 |
 *
 * **실행 이력이 없으면 "통과"라고 말하지 않습니다.** 모르는 것을 통과로
 * 처리하지 않는다는 원칙이 CI에도 그대로 적용됩니다 — 한 번도 안 돈 CI와
 * 통과한 CI는 완전히 다릅니다.
 */

/**
 * CI가 반드시 돌려야 하는 게이트 (CTO가 매 TASK 요구하는 것 중 자동화 가능한 것).
 *
 * `ci-gates`(TASK-3501 — CTO 지시 4)는 **이 목록 자체를 검증**합니다. 게이트
 * 한 줄이 워크플로에서 사라져도 CI는 초록으로 끝나기 때문입니다 — 없어진
 * 검사는 실패하지 않습니다.
 */
export const REQUIRED_CI_GATES = [
  { id: "build", script: "pnpm build", title: "Build" },
  {
    id: "major-migrations",
    script: "pnpm check:major-migrations",
    title: "Major Migration 교차 검증",
  },
  {
    id: "ci-gates",
    script: "pnpm check:ci-gates",
    title: "품질 게이트 자체 검증",
  },
  { id: "typecheck", script: "pnpm typecheck", title: "TypeScript" },
  { id: "lint", script: "pnpm lint", title: "ESLint" },
  // Core/API와 Web e2e는 **병렬 Job**으로 나뉘어 있다 (TASK-3601, 정책 3601-④).
  // 한 Job이 4분을 쓰던 구조에서는 e2e가 늘 때마다 모든 게이트의 답이
  // 늦어졌고, 게이트가 느려지면 사람은 게이트를 안 기다린다.
  { id: "test-unit", script: "pnpm test:unit", title: "Test (Core · API)" },
  { id: "test-e2e", script: "pnpm test:e2e", title: "Test (Web e2e)" },
] as const;

export type CiGateId = (typeof REQUIRED_CI_GATES)[number]["id"];

export interface CiGateView {
  id: CiGateId;
  title: string;
  script: string;
  present: boolean;
  /** 파일에서 몇 번째 위치에 있는가 (없으면 -1) */
  position: number;
}

export interface CiWorkflowJudgement {
  gates: CiGateView[];
  missing: CiGateId[];
  /** 순서가 어긋난 게이트 (Build → 교차 검증 → 그 외) */
  outOfOrder: CiGateId[];
  /**
   * Playwright 브라우저 설치 단계가 있는가.
   *
   * web e2e는 브라우저 없이 통째로 실패하고, 그 실패는 "코드가 잘못됐다"로
   * 읽힙니다 — 실제로는 환경이 준비되지 않은 것입니다. 실제로 이 저장소에서
   * 13회 연속 실패의 원인이 이것이었습니다.
   */
  browsersInstalled: boolean;
  ok: boolean;
  detail: string;
}

/**
 * 워크플로 파일을 판정한다 (순수 함수).
 *
 * 순서 규칙: **Build → Major Migration 교차 검증 → 나머지**
 * (CTO 결정 2101-③ — 교차 검증 로직이 `@acos/core`에 있어 빌드 산출물이
 * 필요합니다. 앞으로 옮기면 모듈을 못 찾아 조용히 실패합니다.)
 */
export function judgeCiWorkflow(yaml: string): CiWorkflowJudgement {
  const gates: CiGateView[] = REQUIRED_CI_GATES.map((gate) => {
    const position = yaml.indexOf(`run: ${gate.script}`);
    return {
      id: gate.id,
      title: gate.title,
      script: gate.script,
      present: position > -1,
      position,
    };
  });

  const missing = gates.filter((gate) => !gate.present).map((gate) => gate.id);
  const at = (id: CiGateId) =>
    gates.find((gate) => gate.id === id)?.position ?? -1;

  const outOfOrder: CiGateId[] = [];
  const build = at("build");
  const cross = at("major-migrations");
  if (build > -1 && cross > -1 && cross < build) {
    outOfOrder.push("major-migrations");
  }
  for (const id of ["ci-gates", "typecheck", "lint", "test-unit"] as const) {
    const position = at(id);
    if (position > -1 && cross > -1 && position < cross) {
      outOfOrder.push(id);
    }
  }

  // `playwright install`이 없으면 러너에 브라우저가 없어 e2e가 통째로 죽는다
  const browsersInstalled = /playwright install/.test(yaml);

  const ok = missing.length === 0 && outOfOrder.length === 0 && browsersInstalled;
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`빠진 게이트: ${missing.join(", ")}`);
  }
  if (outOfOrder.length > 0) {
    parts.push(`순서가 어긋난 게이트: ${outOfOrder.join(", ")}`);
  }
  if (!browsersInstalled) {
    parts.push(
      "Playwright 브라우저 설치 단계가 없습니다 — pnpm test에 web e2e가 포함되어 " +
        "브라우저 없이는 테스트 게이트 전체가 실패합니다",
    );
  }

  return {
    gates,
    missing,
    outOfOrder,
    browsersInstalled,
    ok,
    detail: ok
      ? `필수 게이트 ${gates.length}개가 순서대로 있고 브라우저 설치 단계도 있습니다.`
      : `${parts.join(" · ")}.`,
  };
}

/** 실행 1건 (GitHub Actions run) */
export interface CiRunInput {
  id: number;
  branch: string;
  sha: string;
  status: string;
  /** success | failure | cancelled | null(진행 중) */
  conclusion: string | null;
  createdAt: string;
}

export type CiRunStatus = "green" | "red" | "running" | "unknown";

export interface CiRunJudgement {
  status: CiRunStatus;
  /** 가장 최근 실행 */
  latest: CiRunInput | null;
  /** 연속 실패 횟수 (최근부터) */
  consecutiveFailures: number;
  total: number;
  detail: string;
}

/**
 * 최근 실행 결과를 판정한다 (순수 함수).
 *
 * **이력이 없으면 `unknown`입니다** — "실패한 적이 없다"와 "한 번도 안 돌았다"를
 * 같은 초록으로 보여 주면, 아무도 CI를 켜지 않은 저장소가 가장 건강해 보입니다.
 *
 * 연속 실패를 세는 이유: 한 번의 실패는 흔하지만, **계속 빨간 CI는 사실상 CI가
 * 없는 것**입니다. 아무도 색을 보지 않게 되기 때문입니다.
 */
export function judgeCiRuns(input: {
  runs: CiRunInput[];
  /** 이 브랜치의 실행만 본다 — 없으면 전부 */
  branch?: string;
}): CiRunJudgement {
  const runs = (
    input.branch === undefined
      ? input.runs
      : input.runs.filter((run) => run.branch === input.branch)
  )
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (runs.length === 0) {
    return {
      status: "unknown",
      latest: null,
      consecutiveFailures: 0,
      total: 0,
      detail:
        "CI 실행 이력이 없습니다 — 통과한 적이 없는 것과 한 번도 돌지 않은 것은 " +
        "다릅니다. 워크플로가 이 브랜치에서 실제로 도는지 확인하세요.",
    };
  }

  const latest = runs[0];
  let consecutiveFailures = 0;
  for (const run of runs) {
    if (run.conclusion === "failure") {
      consecutiveFailures += 1;
      continue;
    }
    break;
  }

  if (latest.conclusion === null || latest.status !== "completed") {
    return {
      status: "running",
      latest,
      consecutiveFailures,
      total: runs.length,
      detail: `가장 최근 실행(${latest.sha.slice(0, 8)})이 아직 진행 중입니다.`,
    };
  }

  if (latest.conclusion === "success") {
    return {
      status: "green",
      latest,
      consecutiveFailures: 0,
      total: runs.length,
      detail: `가장 최근 실행(${latest.sha.slice(0, 8)})이 통과했습니다.`,
    };
  }

  return {
    status: "red",
    latest,
    consecutiveFailures,
    total: runs.length,
    detail:
      `가장 최근 실행(${latest.sha.slice(0, 8)})이 ${latest.conclusion}로 끝났습니다` +
      (consecutiveFailures > 1
        ? ` — 최근 ${consecutiveFailures}회 연속 실패입니다. 로컬에서만 통과하는 게이트는 게이트가 아닙니다.`
        : ".") ,
  };
}

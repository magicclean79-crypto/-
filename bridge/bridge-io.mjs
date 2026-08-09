/**
 * CTO Bridge — 통신 계층 (Communication Layer)
 *
 * ChatGPT(총괄)와 Claude Code(실행자)가 **작업 지시와 결과를 주고받는**
 * 통로다.
 *
 * ## 지금은 파일이다 (CTO 지시 10)
 *
 * ChatGPT가 Claude Code를 직접 호출하는 연결은 **아직 없다.** 있다고
 * 가정하지 않는다. 그래서 지금은 저장소 안의 파일로 주고받는다 —
 * 사람이 복사해 옮겨도 되고, 나중에 API가 생기면 이 파일만 바꾸면 된다.
 *
 * 상태 판정(`bridge-state.mjs`)과 실행(Claude Code)은 이 파일을 몰라도
 * 된다. 그래서 통신 방식이 바뀌어도 나머지는 그대로다.
 *
 * ## 파일 배치
 *
 *   bridge/tasks/<taskId>.json      ChatGPT → Claude  (작업 지시)
 *   bridge/results/<taskId>.json    Claude → ChatGPT  (작업 결과)
 *   bridge/STATUS.md                사람과 ChatGPT가 읽는 현재 상태 요약
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { blockedGate, canTransition, readyForReview, summarize } from "./bridge-state.mjs";
import { DEFAULT_PROJECT_ID, projectPaths, requireProject } from "./bridge-projects.mjs";

/**
 * 프로젝트별 경로를 고른다.
 *
 * 어느 프로젝트의 작업인지 **부르는 쪽이 정한다.** 주지 않으면 기본
 * 프로젝트다 — 그래야 예전 호출이 그대로 동작한다.
 */
function dirsFor(projectId = DEFAULT_PROJECT_ID) {
  return projectPaths(projectId);
}

function ensureDirs(projectId = DEFAULT_PROJECT_ID) {
  const p = dirsFor(projectId);
  for (const dir of [p.TASKS_DIR, p.RESULTS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return p;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * 목록을 훑을 때 쓴다 — 파일 하나가 깨져도 **서버 전체를 죽이지 않는다.**
 *
 * 실측(2026-08-09, T1-28): 디스크 공간이 바닥난 상태에서 작업 파일을 쓰다가
 * 0바이트로 잘린 파일(`bridge/tasks/T1-30.json`)이 생겼다. `listTasks`가
 * 서버 시작·복구(`recoverAbandonedRuns`) 경로에서 매번 불리므로, 깨진
 * 파일 하나가 있으면 **Bridge 서버 자체가 뜨지 못했다** — 무인 실행에서
 * 가장 위험한 실패(M-26: 조용히 멈추는 것)의 또 다른 얼굴이다. 깨진
 * 파일은 지우지 않는다(무슨 지시였는지 모르니 추측해서 없애지 않는다) —
 * 읽기에서만 건너뛰고 경고를 남긴다.
 */
function readJsonSkipBroken(path) {
  try {
    return readJson(path);
  } catch (error) {
    console.warn(`[bridge] 깨진 JSON을 건너뜁니다: ${path} — ${error.message}`);
    return null;
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** ChatGPT가 내린 작업 지시를 등록한다 */
export function createTask({
  taskId,
  title,
  request,
  requestedBy = "ChatGPT",
  projectId = DEFAULT_PROJECT_ID,
}) {
  // 없는 프로젝트에 작업을 넣으면 실행할 때가 아니라 지금 막는다.
  requireProject(projectId);
  const p = ensureDirs(projectId);
  if (!taskId || !title || !request) {
    throw new Error("taskId · title · request 는 필수입니다.");
  }
  const path = join(p.TASKS_DIR, `${taskId}.json`);
  if (existsSync(path)) {
    throw new Error(`이미 있는 작업입니다: ${taskId}`);
  }
  const task = {
    taskId,
    projectId,
    title,
    request,
    requestedBy,
    state: "REQUESTED",
    // 시각은 호출자가 넘긴다 — 이 모듈이 시계를 읽으면 재현이 안 된다.
    createdAt: new Date().toISOString(),
  };
  writeJson(path, task);
  return task;
}

/** 작업 지시를 읽는다 */
export function readTask(taskId, projectId = DEFAULT_PROJECT_ID) {
  const path = join(dirsFor(projectId).TASKS_DIR, `${taskId}.json`);
  if (!existsSync(path)) return null;
  return { projectId, ...readJson(path) };
}

/** 등록된 작업 전체 — 깨진 파일이 섞여 있어도 나머지는 정상적으로 나온다 */
export function listTasks(projectId = DEFAULT_PROJECT_ID) {
  const p = ensureDirs(projectId);
  return readdirSync(p.TASKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const task = readJsonSkipBroken(join(p.TASKS_DIR, f));
      return task ? { projectId, ...task } : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.taskId).localeCompare(String(b.taskId)));
}

/** 결과를 읽는다 (없으면 null) */
export function readResult(taskId, projectId = DEFAULT_PROJECT_ID) {
  const path = join(dirsFor(projectId).RESULTS_DIR, `${taskId}.json`);
  if (!existsSync(path)) return null;
  return readJson(path);
}

/**
 * 작업 결과를 기록한다.
 *
 * **상태를 건너뛰면 거부한다.** 코드를 썼다고 바로 사람에게 보여 주는
 * 일을 막는다 — 그건 검증이 아니다.
 */
export function writeResult(result) {
  const projectId = result?.projectId ?? DEFAULT_PROJECT_ID;
  const p = ensureDirs(projectId);
  const { taskId, state } = result ?? {};
  if (!taskId || !state) throw new Error("taskId · state 는 필수입니다.");

  const task = readTask(taskId, projectId);
  if (!task) throw new Error(`등록되지 않은 작업입니다: ${taskId}`);

  const previous = readResult(taskId, projectId);
  const from = previous?.state ?? task.state ?? "REQUESTED";
  if (from !== state) {
    const check = canTransition(from, state);
    if (!check.ok) throw new Error(check.reason);
  }

  if (state === "READY_FOR_REVIEW") {
    // 어떤 검사를 요구할지는 **프로젝트가 정한다** — 빌드도 타입체크도
    // 없는 저장소에 네 가지를 강요하면 통과할 방법이 없다(실측, demo-shop).
    const gate = readyForReview(result, requireProject(projectId).requiredChecks);
    if (!gate.ok) {
      throw new Error(`READY_FOR_REVIEW로 올릴 수 없습니다 — ${gate.reason}`);
    }
  }

  // 막히는 것도 게이트를 통과해야 한다 — 무엇을 정해야 하는지 없이는 안 된다.
  if (state === "BLOCKED") {
    const gate = blockedGate(result);
    if (!gate.ok) {
      throw new Error(`BLOCKED로 둘 수 없습니다 — ${gate.reason}`);
    }
  }

  const record = { ...result, projectId, updatedAt: new Date().toISOString() };
  writeJson(join(p.RESULTS_DIR, `${taskId}.json`), record);
  return record;
}

/**
 * 이미 있는 결과 위에 **덧쓴다.**
 *
 * 비동기 실행에서는 같은 작업의 기록을 여러 번 고친다 — 시작 표시,
 * 심장박동, 최종 결과. 매번 전체를 다시 적으면 앞서 적어 둔 것이 지워진다.
 * 상태 게이트는 `writeResult`가 그대로 본다.
 */
export function updateResult(taskId, patch, projectId = DEFAULT_PROJECT_ID) {
  const previous = readResult(taskId, projectId) ?? {};
  const task = readTask(taskId, projectId);
  const state = patch.state ?? previous.state ?? task?.state ?? "REQUESTED";
  return writeResult({ ...previous, ...patch, taskId, projectId, state });
}

/**
 * 멈춘 작업을 대기열로 되돌린다.
 *
 * **막힌 상태는 스스로 풀리지 않는다.** 다음 실행은 REQUESTED만 찾기
 * 때문에, 되돌리지 않으면 그 작업은 영원히 실행되지 않는다. IN_PROGRESS에
 * 갇힌 것(실행 프로세스가 죽음)도, TESTING에 멈춘 것(검증 기록이 게이트를
 * 통과 못 함)도 여기로 푼다.
 *
 * **게이트를 우회하지 않는다.** 허용된 전이를 한 칸씩 되짚어 간다 —
 * 되돌아가는 길도 상태 계층이 인정하는 길이어야 한다.
 */
const BACK_TO_QUEUE = {
  REQUESTED: [],
  IN_PROGRESS: ["REQUESTED"],
  TESTING: ["IN_PROGRESS", "REQUESTED"],
  READY_FOR_REVIEW: ["IN_PROGRESS", "REQUESTED"],
  COMPLETED: null, // 종료 상태는 되돌리지 않는다
  // 사람이 결정을 내려 준 뒤 다시 돌리는 길.
  BLOCKED: ["REQUESTED"],
};

export function resetToRequested(taskId, reason, projectId = DEFAULT_PROJECT_ID) {
  const task = readTask(taskId, projectId);
  if (!task) throw new Error(`등록되지 않은 작업입니다: ${taskId}`);

  const previous = readResult(taskId, projectId) ?? {};
  const from = previous.state ?? task.state ?? "REQUESTED";
  const path = BACK_TO_QUEUE[from];
  if (path === null || path === undefined) {
    throw new Error(`${from} 상태는 대기열로 되돌릴 수 없습니다.`);
  }

  const note = reason ?? "멈춘 작업을 대기열로 되돌렸습니다.";
  let record = previous;
  // 마지막 한 칸(REQUESTED)에서만 실행 흔적을 지운다.
  const cleared = {
    runId: null,
    heartbeatAt: null,
    blockedOn: note,
    // 결정 요청은 대기열로 돌아갈 때 지운다 — 남겨 두면 이미 정해진 것을
    // 다시 물어보는 것처럼 보인다.
    decisionNeeded: null,
    recoveredAt: new Date().toISOString(),
  };
  for (const step of path) {
    record = writeResult({
      ...record,
      taskId,
      projectId,
      state: step,
      ...(step === "REQUESTED" ? cleared : {}),
    });
  }
  if (path.length === 0) {
    // 이미 REQUESTED — 흔적만 정리한다.
    record = writeResult({ ...record, taskId, projectId, state: "REQUESTED", ...cleared });
  }
  return record;
}

/** ChatGPT와 사람이 읽는 현재 상태 요약을 만든다 */
export function renderStatus(projectId = DEFAULT_PROJECT_ID) {
  const project = requireProject(projectId);
  const tasks = listTasks(projectId);
  const rows = tasks.map((task) => summarize(task, readResult(task.taskId, projectId)));

  const lines = [
    `# CTO BRIDGE — ${project.name} 현재 상태`,
    "",
    "> ChatGPT(총괄)와 사람이 읽는 요약입니다. **이 파일은 자동 생성됩니다** —",
    "> 손으로 고치지 마십시오. `node bridge/bridge-cli.mjs status` 로 다시 만듭니다.",
    "",
    `프로젝트: **${projectId}** · 저장소: \`${project.repoPath}\``,
    `마지막 갱신: ${new Date().toISOString()}`,
    "",
    "## 작업 목록",
    "",
    "| 작업 ID | 제목 | 상태 | 비용 | 사람 확인 필요 |",
    "| --- | --- | --- | --- | --- |",
  ];

  if (rows.length === 0) {
    lines.push("| (없음) | | | | |");
  } else {
    for (const r of rows) {
      lines.push(
        `| ${r.taskId} | ${r.title ?? "-"} | **${r.state}** | ${
          r.costIncurred ? "발생" : "없음"
        } | ${r.needsHumanDecision ? "**예**" : "아니오"} |`,
      );
    }
  }

  const review = rows.filter((r) => r.state === "READY_FOR_REVIEW");
  if (review.length > 0) {
    lines.push("", "## 사람이 브라우저에서 확인할 것", "");
    for (const r of review) {
      lines.push(`- **${r.taskId}** — ${r.browserUrl ?? "(주소 없음)"}`);
    }
  }

  // 사람이 결정을 내려 줘야 멈춘 작업 — ChatGPT CTO가 가장 먼저 볼 곳이다.
  const decisions = rows.filter((r) => r.state === "BLOCKED");
  if (decisions.length > 0) {
    lines.push("", "## 사장님 결정이 필요한 것", "");
    for (const r of decisions) {
      lines.push(`- **${r.taskId}** — ${r.title ?? ""}`);
      for (const d of r.decisionNeeded ?? []) {
        lines.push(`  - ${d.question}`);
        if (Array.isArray(d.options) && d.options.length > 0) {
          lines.push(`    - 선택지: ${d.options.join(" / ")}`);
        }
        if (d.why) lines.push(`    - 스스로 정할 수 없는 이유: ${d.why}`);
      }
    }
  }

  const blocked = rows.filter((r) => r.blockedOn && r.state !== "BLOCKED");
  if (blocked.length > 0) {
    lines.push("", "## 막혀 있는 작업", "");
    for (const r of blocked) lines.push(`- **${r.taskId}** — ${r.blockedOn}`);
  }

  const text = `${lines.join("\n")}\n`;
  const p = ensureDirs(projectId);
  writeFileSync(p.STATUS_FILE, text, "utf8");
  return text;
}

/** 기본 프로젝트의 경로 — 예전 호출이 그대로 쓰던 값이다 */
export const paths = projectPaths(DEFAULT_PROJECT_ID);

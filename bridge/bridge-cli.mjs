/**
 * CTO Bridge — 실행 도구 (CLI)
 *
 * ChatGPT가 내린 작업을 등록하고, Claude Code가 결과를 기록하고,
 * 사람이 현재 상태를 보는 통로다.
 *
 * ## 쓰는 법
 *
 *   node bridge/bridge-cli.mjs new <작업ID> "<제목>" "<요청 내용>" [--project <ID>]
 *   node bridge/bridge-cli.mjs state <작업ID> <상태> [--project <ID>]
 *   node bridge/bridge-cli.mjs result <작업ID> <결과JSON파일> [--project <ID>]
 *   node bridge/bridge-cli.mjs show <작업ID> [--project <ID>]
 *   node bridge/bridge-cli.mjs reset <작업ID> [사유] [--project <ID>]
 *   node bridge/bridge-cli.mjs status [--project <ID>]
 *   node bridge/bridge-cli.mjs project list
 *   node bridge/bridge-cli.mjs project register <등록JSON파일>
 *   node bridge/bridge-cli.mjs project show <ID>
 *
 * `--project`를 생략하면 **기본 프로젝트(acos)** 를 대상으로 한다 — 예전
 * 호출이 그대로 동작하는 이유다(2026-08-09, 다중 프로젝트 지원).
 *
 * `status`는 그 프로젝트의 `STATUS.md`를 다시 만든다 — ChatGPT가 그
 * 파일을 읽고 다음 작업을 정한다.
 */

import { readFileSync } from "node:fs";
import {
  createTask,
  readTask,
  readResult,
  writeResult,
  resetToRequested,
  listTasks,
  renderStatus,
  paths,
} from "./bridge-io.mjs";
import { DEFAULT_PROJECT_ID, listProjects, projectPaths, readProject, registerProject } from "./bridge-projects.mjs";

function fail(message) {
  console.error(`오류: ${message}`);
  process.exit(1);
}

/**
 * `--project <ID>` 를 어디에 있든 뽑아낸다. 나머지 인자는 순서 그대로
 * 남는다 — 명령마다 위치 인자를 다시 셀 필요가 없게 한다.
 */
function extractProject(rawArgs) {
  const args = [...rawArgs];
  const at = args.indexOf("--project");
  if (at === -1) return { projectId: DEFAULT_PROJECT_ID, rest: args };
  const projectId = args[at + 1];
  if (!projectId) fail("--project 뒤에 프로젝트ID가 필요합니다.");
  args.splice(at, 2);
  return { projectId, rest: args };
}

function printUsage() {
  console.log(
    [
      "CTO Bridge",
      "",
      "  new <작업ID> \"<제목>\" \"<요청>\" [--project <ID>]   작업 지시를 등록한다",
      "  state <작업ID> <상태> [--project <ID>]             상태만 바꾼다",
      "  result <작업ID> <결과JSON파일> [--project <ID>]     작업 결과를 기록한다",
      "  show <작업ID> [--project <ID>]                     한 작업의 지시와 결과를 본다",
      "  reset <작업ID> [사유] [--project <ID>]              갇힌 작업을 대기열로 되돌린다",
      "  status [--project <ID>]                            STATUS.md를 다시 만든다",
      "  project list                                       등록된 프로젝트 전부를 본다",
      "  project register <등록JSON파일>                     새 프로젝트를 등록한다",
      "  project show <ID>                                  프로젝트 등록 정보를 본다",
      "",
      "  --project 를 생략하면 기본 프로젝트(acos)를 대상으로 한다.",
      `  작업 지시(기본 프로젝트): ${paths.TASKS_DIR}`,
      `  작업 결과(기본 프로젝트): ${paths.RESULTS_DIR}`,
    ].join("\n"),
  );
}

try {
  const [, , command, ...rawArgs] = process.argv;

  switch (command) {
    case "new": {
      const { projectId, rest } = extractProject(rawArgs);
      const [taskId, title, request] = rest;
      if (!taskId || !title || !request) fail("작업ID · 제목 · 요청이 모두 필요합니다.");
      const task = createTask({ taskId, title, request, projectId });
      console.log(`등록됨: ${task.taskId} — ${task.title} (${task.state}) [프로젝트: ${projectId}]`);
      renderStatus(projectId);
      break;
    }

    case "state": {
      const { projectId, rest } = extractProject(rawArgs);
      const [taskId, state] = rest;
      if (!taskId || !state) fail("작업ID와 상태가 필요합니다.");
      const previous = readResult(taskId, projectId) ?? {};
      const record = writeResult({ ...previous, taskId, projectId, state });
      console.log(`[${projectId}] ${taskId} → ${record.state}`);
      renderStatus(projectId);
      break;
    }

    case "result": {
      const { projectId, rest } = extractProject(rawArgs);
      const [taskId, jsonPath] = rest;
      if (!taskId || !jsonPath) fail("작업ID와 결과 JSON 파일 경로가 필요합니다.");
      const payload = JSON.parse(readFileSync(jsonPath, "utf8"));
      const record = writeResult({ ...payload, taskId, projectId });
      console.log(`[${projectId}] ${taskId} 결과 기록됨 (${record.state})`);
      renderStatus(projectId);
      break;
    }

    case "show": {
      const { projectId, rest } = extractProject(rawArgs);
      const [taskId] = rest;
      if (!taskId) fail("작업ID가 필요합니다.");
      const task = readTask(taskId, projectId);
      if (!task) fail(`없는 작업입니다: [${projectId}] ${taskId}`);
      console.log(JSON.stringify({ task, result: readResult(taskId, projectId) }, null, 2));
      break;
    }

    // 중단된 실행을 대기열로 되돌린다. 서버가 죽으면 Claude Code도 함께
    // 죽는데, 상태는 IN_PROGRESS로 남는다 — 그러면 아무도 다시 집지 않는다.
    case "reset": {
      const { projectId, rest } = extractProject(rawArgs);
      const [taskId, ...reasonParts] = rest;
      if (!taskId) fail("작업ID가 필요합니다.");
      const record = resetToRequested(taskId, reasonParts.join(" ") || undefined, projectId);
      console.log(`[${projectId}] ${taskId} → ${record.state} (${record.blockedOn})`);
      renderStatus(projectId);
      break;
    }

    case "status": {
      const { projectId } = extractProject(rawArgs);
      renderStatus(projectId);
      const tasks = listTasks(projectId);
      console.log(`[${projectId}] 작업 ${tasks.length}건 — STATUS.md 갱신 완료`);
      for (const t of tasks) {
        const r = readResult(t.taskId, projectId);
        console.log(`  ${t.taskId}  ${r?.state ?? t.state}  ${t.title}`);
      }
      break;
    }

    // 프로젝트 등록 계층 — 새 프로젝트를 이 Bridge에 알린다. 등록 전에는
    // 그 프로젝트를 대상으로 작업을 만들 수 없다(bridge-io.mjs가 막는다).
    case "project": {
      const [sub, ...subArgs] = rawArgs;
      if (sub === "list") {
        for (const p of listProjects()) {
          const mark = p.projectId === DEFAULT_PROJECT_ID ? " (기본)" : "";
          console.log(`${p.projectId}${mark}  ${p.name}  ${p.repoPath}`);
        }
        break;
      }
      if (sub === "register") {
        const [jsonPath] = subArgs;
        if (!jsonPath) {
          fail(
            "등록할 프로젝트 설정 JSON 파일 경로가 필요합니다. " +
              '필요한 값: projectId, name, repoPath (선택: docs, doNotTouch, verifyCommands, browserUrl, scope)',
          );
        }
        const input = JSON.parse(readFileSync(jsonPath, "utf8"));
        const project = registerProject(input);
        console.log(`등록됨: ${project.projectId} — ${project.name}`);
        console.log(`  저장소: ${project.repoPath}`);
        console.log(`  작업 지시: ${projectPaths(project.projectId).TASKS_DIR}`);
        renderStatus(project.projectId);
        break;
      }
      if (sub === "show") {
        const [projectId] = subArgs;
        if (!projectId) fail("프로젝트ID가 필요합니다.");
        const project = readProject(projectId);
        if (!project) fail(`등록되지 않은 프로젝트입니다: ${projectId}`);
        console.log(JSON.stringify(project, null, 2));
        break;
      }
      fail("project list | project register <설정JSON경로> | project show <ID>");
      break;
    }

    default:
      printUsage();
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

/**
 * CTO Bridge — 실행 계층 (Executor)
 *
 * REQUESTED 상태의 작업을 집어 **Claude Code를 헤드리스로 실제 호출**해
 * 수행하고, 결과를 Bridge에 기록한다. 사람이 복사·붙여넣기 하지 않는다.
 *
 * ## 실측으로 확인한 것 (2026-08-09)
 *
 * Claude Code CLI 실행 파일이 VS Code 확장 안에 번들되어 있다:
 *   ~/.vscode/extensions/anthropic.claude-code-<버전>-win32-x64/
 *     resources/native-binary/claude.exe
 *
 * `claude -p "<지시>" --output-format json` 으로 **실제 호출이 되는 것을
 * 확인했다**(응답 JSON 수신, 비용 청구 확인). PATH에는 없으므로 확장
 * 폴더에서 최신 버전을 찾아 쓴다.
 *
 * ## 하지 않는 것
 *
 * 이 파일은 **작업을 고르고 호출하고 결과를 적을 뿐**이다. 무엇을 어떻게
 * 고칠지는 호출된 Claude Code가 정한다 — 그래야 실행 계층이 특정 작업
 * 내용에 묶이지 않는다.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  listTasks,
  readResult,
  writeResult,
  updateResult,
  resetToRequested,
  renderStatus,
} from "./bridge-io.mjs";
import { abandonedRun } from "./bridge-state.mjs";
import { DEFAULT_PROJECT_ID, listProjects, requireProject } from "./bridge-projects.mjs";

/** 확장 폴더에서 Claude Code 실행 파일을 찾는다 — 버전이 올라가도 따라간다 */
export function findClaudeBinary() {
  const fromEnv = process.env.CLAUDE_CODE_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const extRoot = join(homedir(), ".vscode", "extensions");
  if (!existsSync(extRoot)) return null;

  const candidates = readdirSync(extRoot)
    .filter((name) => name.startsWith("anthropic.claude-code-"))
    .sort()
    .reverse()
    .map((name) => join(extRoot, name, "resources", "native-binary", "claude.exe"))
    .filter((p) => existsSync(p));

  return candidates[0] ?? null;
}

/**
 * 작업 지시를 Claude Code가 읽을 프롬프트로 바꾼다.
 *
 * 프로젝트 규칙을 매번 앞에 붙인다 — 호출된 Claude는 이 대화의 맥락을
 * 모르기 때문이다. 문서를 먼저 읽으라고 시키는 것이 핵심이다.
 */
export function buildPrompt(task, project, prior) {
  const docs = project?.docs ?? [];
  const doNotTouch = project?.doNotTouch ?? [];
  const verify = project?.verifyCommands ?? [];
  const answers = prior?.decisionAnswer ?? [];

  const lines = [
    `너는 프로젝트 "${project?.name ?? task.projectId ?? "이 저장소"}" 의 실행자다.`,
    "아래 순서를 반드시 지켜라.",
    "",
    "[가장 중요 — 사람은 자리에 없다]",
    "이 작업은 무인으로 돌아간다. **아무도 화면을 보고 있지 않다.**",
    "- 승인·확인·선택을 사람에게 묻지 않는다. 물어봐도 답할 사람이 없다.",
    "- \"진행할까요?\"·\"어느 쪽으로 할까요?\" 같은 질문으로 끝내지 않는다.",
    "- 판단이 필요하면 **가장 보수적인 쪽을 스스로 고르고**, 무엇을 왜",
    "  골랐는지 결과에 적는다.",
    "",
    "[더 중요 — 시킨 범위를 넘지 않는다]",
    "- **새 기능이나 새 방향을 스스로 정하지 않는다.** 요청에 없는 것을",
    "  \"있으면 좋을 것 같아서\" 만들지 않는다.",
    "- 판단은 **아래 문서와 요청 범위 안에서만** 한다. 문서에 답이 있으면",
    "  그것을 따르고, 어디에서 근거를 찾았는지 적는다.",
    "- 범위를 넘는 결정이 **정말로 필요하면** 스스로 정하지 말고 멈춘다.",
    "  그때는 사람에게 묻는 것이 아니라, decisionNeeded 에 적어서 끝낸다:",
    "  {\"question\":\"무엇을 정해야 하는지\",\"options\":[\"가능한 선택지\"],",
    "   \"why\":\"왜 스스로 정할 수 없는지\"}",
    "  그러면 작업이 BLOCKED 가 되고 총괄이 그것을 본다.",
    "- 스스로 정할 수 있는 것을 사람에게 미루는 것도 실패다. **정말 필요할",
    "  때만** 쓴다.",
    "",
  ];

  if (docs.length > 0) {
    lines.push("[먼저 읽을 문서]", ...docs.map((d) => `- ${d}`), "");
  }

  lines.push(
    "[순서]",
    "1. 위 문서를 먼저 읽는다.",
    "2. 아래 작업을 완성까지 자율 수행한다.",
    "3. 구현이 끝나면 아래 검증 명령을 실제로 돌린다.",
    verify.length > 0 ? verify.map((c) => `   - ${c}`).join("\n") : "   - (등록된 검증 명령 없음)",
    "4. 실패하면 원인을 찾아 고치고 다시 돌린다. 코드를 썼다는 이유로",
    "   완료 처리하지 않는다.",
    "5. 결과 품질을 스스로 판정하지 않는다 — 사람이 판단한다.",
    "",
    "[건드리면 안 되는 것 — 사람 승인 없이 수정 금지]",
    ...doNotTouch.map((d) => `- ${d}`),
    "- 토큰·비밀값을 코드나 Git에 적지 않는다",
    "- 사람이 시키지 않은 커밋·푸시를 하지 않는다",
    "",
  );

  if (project?.scope) {
    lines.push("[이 프로젝트의 범위 — 사장님이 정한 것]", project.scope, "");
  }

  // 앞선 실행이 BLOCKED로 멈추고 사람이 답을 준 경우. **이미 정해진 것을
  // 다시 묻지 않도록** 답을 그대로 실어 준다.
  if (answers.length > 0) {
    lines.push("[이미 내려진 결정 — 다시 묻지 않는다]");
    for (const a of answers) {
      lines.push(`- 물었던 것: ${a.question ?? "(기록 없음)"}`);
      lines.push(`  사장님 결정: ${a.answer ?? "(기록 없음)"}`);
    }
    lines.push("이 결정을 그대로 따른다. 같은 것을 decisionNeeded 에 다시 적지 않는다.", "");
  }

  lines.push(
    `[작업 ID] ${task.taskId}`,
    `[제목] ${task.title}`,
    "[요청]",
    task.request,
    "",
    "[결과 보고 형식]",
    `testResults 에는 **${(project?.requiredChecks ?? ["build", "typecheck", "lint", "tests"]).join(
      " · ",
    )}** 를 반드시 넣는다. 하나라도 빠지면 사람 확인 단계로 올라가지 못한다.`,
    "해당 없는 검사도 빼지 말고 무엇을 확인했는지 적는다(예: 빌드 단계가 없는 프로젝트).",
    "testResults 의 값은 **{\"ok\": true|false, \"detail\": \"...\"} 형태**로 적는다.",
    "ok 는 **이번 변경분이 통과했는가**만 뜻한다. 글로 풀어 쓰지 말고 참/거짓으로",
    "분명히 적어라 — 문장을 읽어 짐작하게 두면 통과해야 할 것이 막힌다.",
    "이번 변경과 무관한 기존 실패(원래부터 실패하던 검사 등)는 ok 를 false 로",
    "만들지 말고 preExisting 에 따로 적는다. 다만 **기존 문제라고 말하려면",
    "근거를 확인하고 말한다**(변경 전에도 같은 실패가 나는지 확인).",
    "검사를 돌리지 않았다면 ok 를 참으로 적지 말고 blockedOn 에 이유를 적어라.",
    "",
    "마지막 줄에 아래 형식으로만 요약해라(다른 말 금지):",
    "RESULT_JSON: {\"workDone\":[...],\"changedFiles\":[...],\"testResults\":" +
      "{\"build\":{\"ok\":true,\"detail\":\"...\"},\"typecheck\":{\"ok\":true,\"detail\":\"...\"}," +
      "\"lint\":{\"ok\":true,\"detail\":\"...\"},\"tests\":{\"ok\":true,\"detail\":\"...\"}}," +
      "\"preExisting\":[...],\"errorsAndFixes\":[...],\"decisionNeeded\":[],\"blockedOn\":null}",
  );

  return lines.join("\n");
}

/**
 * 스트리밍 출력에서 **마지막 결과 이벤트**를 뽑는다.
 *
 * `stream-json` 은 한 줄에 JSON 하나씩 흘려보내고, 마지막에
 * `{"type":"result", "result":"...", "total_cost_usd":…}` 를 낸다.
 * 신뢰 대화상자 경고처럼 JSON이 아닌 줄이 섞일 수 있으므로 **줄 단위로
 * 시도하고 실패한 줄은 넘긴다** — 한 줄이 깨졌다고 전체를 버리지 않는다.
 *
 * 결과 이벤트가 없으면(비정상 종료 등) `null`을 돌려준다. 그 경우 호출자는
 * 원문을 그대로 쓴다.
 */
export function parseStreamJson(text) {
  if (typeof text !== "string") return null;
  let result = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event?.type === "result") result = event;
    } catch {
      /* JSON이 아닌 줄은 건너뛴다 */
    }
  }
  return result;
}

/**
 * 실행 결과에서 **권한 승인 때문에 거부된 도구 호출**을 뽑는다.
 *
 * `--dangerously-skip-permissions` + `--permission-mode bypassPermissions`를
 * 함께 줘도, 그것이 실제로 지켜졌는지는 CLI 내부 동작이라 우리 코드가
 * 보장할 수 없다. 실측(2026-08-09, T1-29)으로 확인한 사실 — 두 플래그를
 * **빼면** 승인이 필요한 Bash 호출이 표준입력을 기다리며 멈추는 대신
 * **즉시 자동 거부**되고, 그 사실이 `result` 이벤트의 `permission_denials`
 * 배열에 남는다. 그래서 **이 배열이 비어 있지 않다는 것 자체가 "이번
 * 실행이 실제로는 완전히 무인이 아니었다"는 증거**다 — 플래그가 어떤
 * 이유로든 안 먹혔다는 뜻이다.
 *
 * 두 플래그가 정상 동작하면 이 배열은 항상 비어 있다(같은 날 실측,
 * 네트워크 호출을 포함한 승인 필요 명령으로 확인).
 */
export function extractPermissionDenials(outcome) {
  const denials = outcome?.response?.permission_denials;
  return Array.isArray(denials) ? denials : [];
}

/**
 * 거부된 도구 호출을 **사람이 정해야 하는 결정**으로 바꾼다.
 *
 * 무인 실행 중 자동 거부가 있었다는 것은 그 도구 호출이 실제로 실행되지
 * 않았고 결과가 그만큼 불완전할 수 있다는 뜻이다. 무엇을 허용할지는 스스로
 * 정하지 않는다(범위를 넘는 결정) — BLOCKED로 만들어 사람에게 남긴다.
 */
export function buildPermissionDecision(permissionDenials) {
  if (!Array.isArray(permissionDenials) || permissionDenials.length === 0) return [];
  const commands = permissionDenials
    .map((d) => `${d.tool_name ?? "?"}(${JSON.stringify(d.tool_input?.command ?? d.tool_input ?? {})})`)
    .join(" · ");
  return [
    {
      question:
        `무인 실행 중 권한 승인이 필요해 자동 거부된 도구 호출이 ${permissionDenials.length}건 ` +
        `있습니다 — 계속하려면 무엇을 허용할지 정해야 합니다: ${commands}`,
      options: [
        "이 명령들을 신뢰된 작업 범위로 인정하고 다시 실행",
        "이 명령이 필요 없는 방식으로 범위를 좁혀 다시 요청",
      ],
      why:
        "무인 실행은 승인 대화를 기다릴 수 없어 CLI가 자동으로 거부했습니다. " +
        "무엇을 허용할 범위로 볼지는 사람만 정할 수 있습니다.",
    },
  ];
}

/** Claude Code 응답에서 RESULT_JSON 을 뽑는다 — 없으면 null */
export function parseResultJson(text) {
  if (typeof text !== "string") return null;
  const hit = /RESULT_JSON:\s*(\{[\s\S]*\})/.exec(text);
  if (!hit) return null;
  try {
    return JSON.parse(hit[1]);
  } catch {
    return null;
  }
}

/* 무인 실행 한계값 — 사람이 자리에 없어도 끝나거나 멈추도록 못 박는다 */
export const RUN_TIMEOUT_MS = Number(process.env.BRIDGE_RUN_TIMEOUT_MS ?? 90 * 60 * 1000);
export const STALL_LIMIT_MS = Number(process.env.BRIDGE_STALL_LIMIT_MS ?? 15 * 60 * 1000);
export const MAX_BUDGET_USD = Number(process.env.BRIDGE_MAX_BUDGET_USD ?? 20);

/**
 * Claude Code를 헤드리스로 한 번 호출한다.
 *
 * ## 사람이 자리에 없다는 전제
 *
 * 이 호출은 **아무도 보고 있지 않을 때** 일어난다. 그래서 "물어보면 멈추는"
 * 자리를 전부 없앤다.
 *
 * | 막는 것 | 어떻게 |
 * | --- | --- |
 * | 권한 승인 창 | `--dangerously-skip-permissions` + `--permission-mode bypassPermissions` |
 * | **표준입력 대기** | `stdin`을 아예 닫는다 (`ignore`) |
 * | 무한 대기 | 전체 시간 제한 |
 * | **조용한 정지** | 일정 시간 출력이 없으면 끊는다 |
 * | 비용 폭주 | `--max-budget-usd` |
 *
 * `stdin`을 열어 둔 채 아무것도 쓰지 않으면, 자식이 입력을 한 번이라도
 * 읽으려는 순간 **영원히 멈춘다.** 그런데 심장박동은 계속 찍히므로 겉으로는
 * 정상으로 보인다 — 가장 위험한 형태의 실패다.
 */
/**
 * Claude Code 호출 인자.
 *
 * **`stream-json`을 쓴다.** `json`은 작업이 끝날 때까지 stdout에 아무것도
 * 쓰지 않는다 — 그러면 "일하는 중"과 "멈춘 것"을 구분할 방법이 없고,
 * 무응답 감지가 정상적인 긴 작업을 죽인다(실측, 2026-08-09).
 * 스트리밍이면 진행하는 동안 계속 줄이 나오므로 정지를 실제로 잡을 수 있다.
 */
export function buildClaudeArgs(prompt) {
  return [
    // **`-p`(비대화형 출력)를 반드시 맨 앞에 둔다.** 설치된 CLI(2.1.226)의
    // 공식 `--help`에 "워크스페이스 신뢰 대화상자는 비대화형 모드(-p 또는
    // stdout이 TTY가 아닐 때)에서 건너뛴다"고 명시돼 있다(실측, T1-29
    // 재검증, 2026-08-09) — 권한 승인 플래그와 별개로 이 신뢰 대화상자
    // 자체가 열리지 않게 하는 조건이다.
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    // 권한 승인 창을 띄우지 않는다. 두 가지를 함께 준다 —
    // 한쪽이 무시돼도 나머지가 막는다.
    "--dangerously-skip-permissions",
    "--permission-mode",
    "bypassPermissions",
    // 아무도 안 볼 때 비용이 무한정 늘지 않게 상한을 준다.
    "--max-budget-usd",
    String(MAX_BUDGET_USD),
  ];
}

/**
 * 무인 실행용 프로세스 설정 — `stdin`을 닫는 것이 핵심이다.
 *
 * stdout·stderr도 `pipe`로 받는다 — TTY가 아니게 만들어 `-p`와 함께
 * 워크스페이스 신뢰 대화상자가 열릴 조건 자체를 없앤다(위 `buildClaudeArgs`
 * 참고).
 */
export function claudeSpawnOptions(cwd) {
  return {
    cwd: cwd ?? process.cwd(),
    windowsHide: true,
    // **표준입력을 닫는다.** 무인 실행에서 입력을 기다리는 일은 없어야 한다.
    stdio: ["ignore", "pipe", "pipe"],
  };
}

export function callClaude(prompt, { cwd, timeoutMs = RUN_TIMEOUT_MS, onProgress } = {}) {
  const bin = findClaudeBinary();
  if (!bin) {
    return Promise.reject(new Error("Claude Code 실행 파일을 찾지 못했습니다."));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, buildClaudeArgs(prompt), claudeSpawnOptions(cwd));

    let out = "";
    let err = "";
    let lastOutputAt = Date.now();
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(stallTimer);
      fn(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Claude Code 호출이 ${Math.round(timeoutMs / 60000)}분을 넘겼습니다.`));
    }, timeoutMs);

    // **조용한 정지를 잡는다.** 아직 도는 것과 멈춘 것은 출력으로만 구분된다.
    const stallTimer = setInterval(() => {
      const idle = Date.now() - lastOutputAt;
      if (idle > STALL_LIMIT_MS) {
        child.kill();
        finish(
          reject,
          new Error(
            `Claude Code가 ${Math.round(idle / 60000)}분 동안 아무 출력이 없어 중단했습니다 ` +
              "(승인 대기 등으로 멈췄을 수 있습니다).",
          ),
        );
      }
    }, 30 * 1000);
    stallTimer.unref?.();

    const note = (chunk) => {
      lastOutputAt = Date.now();
      onProgress?.(chunk);
    };

    child.stdout.on("data", (d) => {
      out += d.toString();
      note(out.length);
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
      note(out.length);
    });
    child.on("error", (e) => finish(reject, e));
    child.on("close", (code) => {
      finish(resolve, { code, raw: out, stderr: err, response: parseStreamJson(out) });
    });
  });
}

/* ------------------------------------------------------------------ *
 * 비동기 실행
 *
 * Claude Code 한 번 호출은 **수 분에서 수십 분**이 걸린다. 그것을 HTTP
 * 응답으로 붙잡고 있으면 중간의 어떤 장비든 먼저 끊는다 — Cloudflare는
 * 100초에서 **524**를 돌려준다(실측, 2026-08-09, T1-22).
 *
 * 그래서 요청과 실행을 분리한다:
 *   요청 → 즉시 202 응답 (작업 ID·실행 ID만 알려 준다)
 *   실행 → 이 프로세스 안에서 계속 돈다
 *   조회 → ChatGPT가 taskId로 상태를 물어본다
 *
 * **끝났는지는 상태가 말한다.** 응답을 기다려서 아는 것이 아니다.
 * ------------------------------------------------------------------ */

/** 지금 이 프로세스가 돌리고 있는 실행 — runId → {taskId, startedAt, done} */
const running = new Map();

/** 심장박동 주기. 이보다 오래 조용하면 버려진 실행으로 본다 */
const HEARTBEAT_MS = 30 * 1000;
export const ABANDON_LIMIT_MS = 5 * 60 * 1000;

/** 지금 돌고 있는 실행 목록 */
export function listRunning() {
  return [...running.entries()].map(([runId, run]) => ({
    runId,
    projectId: run.projectId ?? DEFAULT_PROJECT_ID,
    taskId: run.taskId,
    startedAt: run.startedAt,
  }));
}

/**
 * 중단된 실행을 대기열로 되돌린다.
 *
 * 서버가 다시 뜨면 **이전 실행은 전부 죽어 있다** — Claude Code는 서버의
 * 자식 프로세스이므로 서버와 함께 사라진다. 되돌리지 않으면 그 작업은
 * IN_PROGRESS에 갇혀 다시는 실행되지 않는다.
 */
export function recoverAbandonedRuns({ nowMs = Date.now(), limitMs = ABANDON_LIMIT_MS } = {}) {
  const live = listRunning().map((r) => r.runId);
  const recovered = [];
  // **모든 프로젝트를 본다.** 서버가 죽으면 어느 프로젝트의 실행이든 죽는다.
  for (const project of listProjects()) {
    const projectId = project.projectId;
    let touched = false;
    for (const task of listTasks(projectId)) {
      const result = readResult(task.taskId, projectId);
      const verdict = abandonedRun(result, nowMs, limitMs, live);
      if (!verdict.abandoned) continue;
      resetToRequested(task.taskId, `중단된 실행을 되돌렸습니다 — ${verdict.reason}`, projectId);
      recovered.push({ projectId, taskId: task.taskId, reason: verdict.reason });
      touched = true;
    }
    if (touched) renderStatus(projectId);
  }
  return recovered;
}

/**
 * 실행 중 30초마다 살아 있다고 적는다 — 버려진 실행과 구분하는 유일한 근거.
 *
 * **마지막 출력 시각도 함께 적는다.** 심장박동만 찍히면 "프로세스는 살아
 * 있지만 아무 일도 안 하는" 상태를 구분할 수 없다.
 */
function beat(taskId, runId, progress, projectId) {
  const timer = setInterval(() => {
    try {
      updateResult(
        taskId,
        {
          state: "IN_PROGRESS",
          runId,
          heartbeatAt: new Date().toISOString(),
          lastOutputAt: progress.at,
          outputBytes: progress.bytes,
        },
        projectId,
      );
    } catch {
      /* 기록에 실패해도 실행 자체는 계속한다 */
    }
  }, HEARTBEAT_MS);
  timer.unref?.();
  return timer;
}

/** 실제 수행 — 호출자는 이것을 기다리지 않는다 */
async function executeTask(task, runId, { project, browserUrl, userChecks }) {
  const projectId = project.projectId;
  const startedAt = new Date().toISOString();
  const progress = { at: startedAt, bytes: 0 };
  const timer = beat(task.taskId, runId, progress, projectId);

  try {
    let outcome;
    try {
      outcome = await callClaude(buildPrompt(task, project, readResult(task.taskId, projectId)), {
        // **작업 폴더는 등록 정보에서 온다.** 부르는 쪽이 아무 경로나
        // 넣어 다른 저장소를 건드리는 일은 없어야 한다.
        cwd: project.repoPath,
        onProgress: (bytes) => {
          progress.at = new Date().toISOString();
          progress.bytes = bytes;
        },
      });
    } catch (error) {
      // 호출 자체가 실패하면 **대기열로 되돌린다.** IN_PROGRESS에 남겨 두면
      // 아무도 다시 집지 않는다.
      resetToRequested(task.taskId, `Claude Code 호출 실패: ${error.message}`, projectId);
      return { ran: true, taskId: task.taskId, runId, ok: false, error: error.message };
    }

    const text = outcome.response?.result ?? outcome.raw;
    const summary = parseResultJson(text) ?? {};
    // **무인 실행이 실제로 지켜졌는지 CLI 결과로 직접 확인한다** — 모델의
    // 자기 보고를 믿는 대신, `result` 이벤트의 `permission_denials`를 본다.
    // 비어 있지 않으면 승인이 필요해 자동 거부된 도구 호출이 있었다는
    // 뜻이고, 그 결과는 불완전할 수 있다(T1-29, 2026-08-09).
    const permissionDenials = extractPermissionDenials(outcome);
    const modelDecisions = Array.isArray(summary.decisionNeeded) ? summary.decisionNeeded : [];
    const decisionNeeded = [...modelDecisions, ...buildPermissionDecision(permissionDenials)];
    const common = {
      runId,
      startedAt,
      heartbeatAt: new Date().toISOString(),
      workDone: summary.workDone ?? [],
      changedFiles: summary.changedFiles ?? [],
      testResults: summary.testResults ?? {},
      // 이번 변경과 무관한 기존 실패 — 게이트에서 보지 않되 **버리지도 않는다.**
      preExisting: summary.preExisting ?? [],
      errorsAndFixes: summary.errorsAndFixes ?? [],
      costIncurred: true,
      // 비어 있어야 "이번 실행이 실제로 완전히 무인이었다"는 증거가 된다.
      permissionDenials,
      decisionNeeded: decisionNeeded.length > 0 ? decisionNeeded : null,
      blockedOn: summary.blockedOn ?? null,
    };

    updateResult(
      task.taskId,
      {
        ...common,
        state: "TESTING",
        costDetail: outcome.response?.total_cost_usd
          ? `Claude Code 호출 $${outcome.response.total_cost_usd}`
          : "Claude Code 호출",
        rawResponse: typeof text === "string" ? text.slice(0, 4000) : null,
      },
      projectId,
    );
    renderStatus(projectId);

    // 사람의 결정이 필요하다고 적어 왔으면 **거기서 멈춘다.** 범위를 넘는
    // 판단을 스스로 하는 것보다, 총괄이 볼 수 있게 남기고 서는 편이 낫다.
    if (common.decisionNeeded?.length > 0) {
      try {
        updateResult(
          task.taskId,
          { ...common, state: "BLOCKED", finishedAt: new Date().toISOString() },
          projectId,
        );
        renderStatus(projectId);
        return { ran: true, taskId: task.taskId, runId, ok: true, state: "BLOCKED" };
      } catch (error) {
        // 결정 요청이 부실하면 BLOCKED로 두지 않는다 — 아무도 못 푸는
        // 상태가 되기 때문이다. TESTING에 두고 이유를 남긴다.
        updateResult(
          task.taskId,
          { state: "TESTING", blockedOn: `결정 요청이 불완전함 — ${error.message}` },
          projectId,
        );
        renderStatus(projectId);
        return { ran: true, taskId: task.taskId, runId, ok: false, state: "TESTING", reason: error.message };
      }
    }

    // 검증 기록이 갖춰졌으면 사람에게 보여 줄 수 있는 상태로 올린다.
    try {
      updateResult(
        task.taskId,
        {
          ...common,
          state: "READY_FOR_REVIEW",
          browserUrl: browserUrl ?? project.browserUrl ?? null,
          userChecks: userChecks ?? ["브라우저에서 결과가 의도대로인지"],
          finishedAt: new Date().toISOString(),
        },
        projectId,
      );
    } catch (error) {
      // 올리지 못하면 TESTING에 머문다 — 그것이 사실이다.
      // **왜 머물렀는지 반드시 남긴다.** 이유 없이 TESTING에 멈춰 있으면
      // 다음 사람이 원인을 찾지 못한다(실측, T1-22·T1-23).
      updateResult(
        task.taskId,
        {
          state: "TESTING",
          finishedAt: new Date().toISOString(),
          blockedOn: `사람 확인 단계로 못 올라감 — ${error.message}`,
        },
        projectId,
      );
      renderStatus(projectId);
      return { ran: true, taskId: task.taskId, runId, ok: false, state: "TESTING", reason: error.message };
    }
    renderStatus(projectId);
    return { ran: true, taskId: task.taskId, runId, ok: true, state: "READY_FOR_REVIEW" };
  } finally {
    clearInterval(timer);
    running.delete(runId);
  }
}

/**
 * REQUESTED 작업 하나를 골라 **실행을 시작하고 곧바로 돌아온다.**
 *
 * 상태는 IN_PROGRESS → TESTING → READY_FOR_REVIEW 로 차례대로 옮긴다.
 * 건너뛰면 상태 계층이 거부한다 — 비동기가 되어도 게이트는 그대로다.
 */
export function startNextTask({
  browserUrl,
  userChecks,
  dryRun = false,
  taskId,
  projectId = DEFAULT_PROJECT_ID,
} = {}) {
  // 먼저 죽은 실행을 정리한다 — 안 그러면 대기열이 막힌 채로 보인다.
  const recovered = recoverAbandonedRuns();
  const project = requireProject(projectId);

  const isQueued = (t) => (readResult(t.taskId, projectId)?.state ?? t.state) === "REQUESTED";
  const queue = listTasks(projectId);
  // taskId를 주면 그것만 본다. 안 주면 전과 같이 대기열의 첫 작업을 집는다.
  const pending = taskId ? queue.find((t) => t.taskId === taskId && isQueued(t)) : queue.find(isQueued);

  if (!pending && taskId) {
    const exists = queue.find((t) => t.taskId === taskId);
    return {
      ran: false,
      accepted: false,
      recovered,
      projectId,
      taskId,
      reason: exists
        ? `${taskId} 는 REQUESTED 가 아닙니다 (지금 ${
            readResult(taskId, projectId)?.state ?? exists.state
          }). 되돌리려면 resetTask 를 쓰십시오.`
        : `없는 작업입니다: ${taskId}`,
    };
  }
  if (!pending) {
    const busy = listRunning();
    return {
      ran: false,
      accepted: false,
      recovered,
      projectId,
      running: busy,
      reason:
        busy.length > 0
          ? `실행 중인 작업이 있습니다: ${busy.map((b) => b.taskId).join(", ")}`
          : "REQUESTED 상태인 작업이 없습니다.",
    };
  }

  // dryRun은 **상태를 건드리지 않는다.** 프롬프트만 보려고 부른 것이
  // 작업을 소비하면 안 된다(실측 결함, 2026-08-09).
  if (dryRun) {
    return {
      ran: false,
      accepted: false,
      dryRun: true,
      projectId,
      taskId: pending.taskId,
      prompt: buildPrompt(pending, project, readResult(pending.taskId, projectId)),
      recovered,
    };
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  writeResult({
    ...(readResult(pending.taskId, projectId) ?? {}),
    taskId: pending.taskId,
    projectId,
    state: "IN_PROGRESS",
    runId,
    startedAt,
    heartbeatAt: startedAt,
    // 지난 실행의 흔적을 지운다 — 남겨 두면 새 실행이 시작하자마자
    // "오래 무응답"인 것처럼 보인다.
    lastOutputAt: startedAt,
    outputBytes: 0,
    finishedAt: null,
    blockedOn: null,
    decisionNeeded: null,
  });
  renderStatus(projectId);

  // **여기서 기다리지 않는다.** 이 한 줄이 524를 막는다.
  const done = executeTask(pending, runId, { project, browserUrl, userChecks }).catch((error) => {
    try {
      resetToRequested(pending.taskId, `실행 중 오류: ${error.message}`, projectId);
    } catch {
      /* 되돌리기까지 실패하면 기록만 남기고 넘어간다 */
    }
    return { ran: true, taskId: pending.taskId, runId, ok: false, error: error.message };
  });
  running.set(runId, { taskId: pending.taskId, projectId, startedAt, done });

  return {
    ran: true,
    accepted: true,
    projectId,
    taskId: pending.taskId,
    runId,
    state: "IN_PROGRESS",
    startedAt,
    recovered,
    // ChatGPT에게 **기다리지 말고 물어보라고** 알려 준다.
    pollWith: `GET /tasks/${pending.taskId}?project=${projectId}`,
    note: "작업은 백그라운드에서 계속됩니다. 응답을 기다리지 말고 taskId로 상태를 조회하십시오.",
  };
}

/** 시작된 실행이 끝날 때까지 기다린다 — CLI·검사에서만 쓴다 */
export function waitForRun(runId) {
  const run = running.get(runId);
  if (!run) return Promise.resolve(null);
  return run.done;
}

/**
 * 예전 방식 — 시작하고 **끝까지 기다린다.**
 *
 * HTTP 경로에서는 쓰지 않는다(524). 명령줄과 검사에서만 쓴다.
 */
export async function runNextTask(options = {}) {
  const started = startNextTask(options);
  if (!started.accepted) return started;
  return (await waitForRun(started.runId)) ?? started;
}

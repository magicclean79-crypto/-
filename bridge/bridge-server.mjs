/**
 * CTO Bridge — HTTP 통신 계층 (Server)
 *
 * 외부(ChatGPT 등)가 작업을 넣고 결과를 가져가는 **실제 HTTP API**다.
 * 파일 기반 계층(`bridge-io.mjs`)을 그대로 쓰고, 그 위에 통로만 얹는다 —
 * 파일 방식은 복구·대체 수단으로 남는다.
 *
 * ## 실행
 *
 *   node bridge/bridge-server.mjs            (기본 포트 4200)
 *   BRIDGE_PORT=4300 node bridge/bridge-server.mjs
 *   BRIDGE_TOKEN=<비밀값> node bridge/bridge-server.mjs   (인증 켜기)
 *
 * ## 엔드포인트
 *
 *   GET  /health              살아 있는지
 *   GET  /tasks               작업 목록과 상태
 *   GET  /tasks/:id           작업 하나(지시 + 결과)
 *   POST /tasks               작업 등록      {taskId,title,request}
 *   POST /tasks/:id/state     상태만 변경    {state}
 *   POST /tasks/:id/result    결과 기록      {…}
 *   POST /tasks/:id/reset     갇힌 작업을 대기열로 되돌림
 *   POST /run                 REQUESTED 작업 하나의 실행을 **시작**하고 즉시 응답
 *   GET  /runs                지금 돌고 있는 실행
 *   POST /recover             중단된 실행 전부를 대기열로 되돌림
 *   GET  /status              STATUS.md 원문
 *
 * ## 실행은 기다리지 않는다
 *
 * `/run` 은 **202로 즉시 응답한다.** Claude Code 호출은 수 분~수십 분이고,
 * 그동안 HTTP 응답을 붙잡고 있으면 Cloudflare가 100초에서 **524**로 끊는다
 * (실측, 2026-08-09, T1-22). 끝났는지는 `GET /tasks/:id` 로 확인한다.
 *
 * ## 인증
 *
 * `BRIDGE_TOKEN`을 주면 `Authorization: Bearer <값>`을 요구한다. 주지 않으면
 * 인증 없이 동작하되, **127.0.0.1에만 바인딩**한다 — 같은 PC에서만 접근
 * 가능하다는 뜻이다. 외부에 노출하려면 반드시 토큰을 설정한다.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
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
import { summarize } from "./bridge-state.mjs";
import { startNextTask, listRunning, recoverAbandonedRuns } from "./bridge-executor.mjs";
import {
  DEFAULT_PROJECT_ID,
  listProjects,
  projectPaths,
  readProject,
  registerProject,
} from "./bridge-projects.mjs";

const PORT = Number(process.env.BRIDGE_PORT ?? 4200);

/**
 * 인증 토큰. 환경변수에 없으면 `bridge/.secrets/bridge-token.txt`에서 읽는다.
 * 그 파일은 `.gitignore`로 막혀 있다 — 저장소에 올라가면 안 된다.
 */
function loadToken() {
  if (process.env.BRIDGE_TOKEN) return process.env.BRIDGE_TOKEN.trim();
  const file = join(paths.TASKS_DIR, "..", ".secrets", "bridge-token.txt");
  if (existsSync(file)) {
    const value = readFileSync(file, "utf8").trim();
    if (value) return value;
  }
  return null;
}

const TOKEN = loadToken();
// 토큰이 없으면 같은 PC에서만 받는다. 토큰이 있어야 외부에 열린다.
const HOST = TOKEN ? "0.0.0.0" : "127.0.0.1";

/**
 * 인증 실패를 기억한다 — 같은 곳에서 반복 실패하면 잠시 막는다.
 *
 * 공개 주소에 열리는 순간 이 서버는 **Claude Code를 실행할 수 있는
 * 통로**가 된다. 토큰을 무작위로 시도하는 것을 방치하면 안 된다.
 */
const failures = new Map();
const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 10 * 60 * 1000;

function lockedOut(ip) {
  const record = failures.get(ip);
  if (!record) return false;
  if (Date.now() - record.at > LOCKOUT_MS) {
    failures.delete(ip);
    return false;
  }
  return record.count >= LOCKOUT_AFTER;
}

function noteFailure(ip) {
  const record = failures.get(ip) ?? { count: 0, at: Date.now() };
  record.count += 1;
  record.at = Date.now();
  failures.set(ip, record);
  console.warn(`인증 실패 (${ip}) — 누적 ${record.count}회`);
}

function send(res, status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // **UTF-8로 못 박는다.** Windows 콘솔에서 curl로 보내면 CP949로 나가는
    // 일이 있고, 그러면 한글이 깨진 채 저장된다(실측, 2026-08-09).
    // 통로가 인코딩을 정해 주지 않으면 보내는 쪽마다 다른 결과가 나온다.
    req.setEncoding("utf8");
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // 본문이 과도하게 크면 끊는다 — 통로가 저장소가 되면 안 된다.
      if (raw.length > 1_000_000) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON 형식이 아닙니다."));
      }
    });
    req.on("error", reject);
  });
}

/**
 * 토큰을 확인한다. **길이가 달라도 같은 시간이 걸리도록** 비교한다 —
 * 문자열 `===` 는 앞에서 갈리면 빨리 끝나서, 반복 측정으로 토큰을
 * 한 글자씩 알아낼 수 있다.
 */
function authorized(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const given = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(TOKEN);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

function clientIp(req) {
  return req.socket.remoteAddress ?? "unknown";
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  const ip = clientIp(req);

  // /health 는 인증 없이 연다 — 살아 있는지만 알려주고, 작업 내용은
  // 노출하지 않는다.
  if (path === "/health") {
    return send(res, 200, { ok: true, authRequired: Boolean(TOKEN) });
  }

  if (lockedOut(ip)) {
    return send(res, 429, { error: "인증 실패가 반복되어 잠시 차단되었습니다." });
  }

  if (!authorized(req)) {
    noteFailure(ip);
    return send(res, 401, { error: "인증이 필요합니다 (Authorization: Bearer <BRIDGE_TOKEN>)" });
  }
  failures.delete(ip);

  // 외부에 열린 상태에서 토큰이 없으면 실행 계통을 아예 막는다.
  // 인증되지 않은 요청이 Claude Code를 실행하는 일은 없어야 한다.
  if (!TOKEN && path === "/run" && ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    return send(res, 403, { error: "토큰 없이 외부에서 실행할 수 없습니다." });
  }

  try {
    // 어느 프로젝트의 요청인가 — 주지 않으면 기본 프로젝트다.
    // 그래야 프로젝트를 몰랐던 예전 호출이 그대로 동작한다.
    const project = url.searchParams.get("project") ?? undefined;

    // 등록된 프로젝트 목록
    if (req.method === "GET" && path === "/projects") {
      return send(res, 200, { projects: listProjects() });
    }

    // 새 프로젝트 등록 — 이후 그 저장소·문서·작업만 대상이 된다
    if (req.method === "POST" && path === "/projects") {
      const body = await readBody(req);
      const registered = registerProject(body);
      renderStatus(registered.projectId);
      return send(res, 201, { project: registered });
    }

    const projectMatch = /^\/projects\/([^/]+)$/.exec(path);
    if (req.method === "GET" && projectMatch) {
      const found = readProject(projectMatch[1]);
      if (!found) return send(res, 404, { error: `없는 프로젝트입니다: ${projectMatch[1]}` });
      return send(res, 200, { project: found });
    }

    // 작업 목록
    if (req.method === "GET" && path === "/tasks") {
      const projectId = project ?? DEFAULT_PROJECT_ID;
      const rows = listTasks(projectId).map((t) => summarize(t, readResult(t.taskId, projectId)));
      return send(res, 200, { projectId, tasks: rows });
    }

    // 작업 등록
    if (req.method === "POST" && path === "/tasks") {
      const body = await readBody(req);
      const task = createTask({ ...body, projectId: body.projectId ?? project ?? DEFAULT_PROJECT_ID });
      renderStatus(task.projectId);
      return send(res, 201, { task });
    }

    // 상태 요약 원문
    if (req.method === "GET" && path === "/status") {
      const projectId = project ?? DEFAULT_PROJECT_ID;
      renderStatus(projectId);
      const file = projectPaths(projectId).STATUS_FILE;
      const text = existsSync(file) ? readFileSync(file, "utf8") : "";
      return send(res, 200, text);
    }

    // REQUESTED 작업 하나의 **실행을 시작하고 곧바로 응답한다.**
    //
    // 여기서 끝날 때까지 기다리면 안 된다. Claude Code 한 번 호출은 수 분
    // ~ 수십 분이고, Cloudflare는 100초에서 **524**로 끊는다(실측,
    // 2026-08-09, T1-22). 실행은 뒤에서 계속되고, 진행 상황은 상태로 본다.
    if (req.method === "POST" && path === "/run") {
      const body = await readBody(req);
      const outcome = startNextTask({
        browserUrl: body.browserUrl,
        userChecks: body.userChecks,
        dryRun: Boolean(body.dryRun),
        // 주지 않으면 전과 같이 대기열의 첫 작업을 집는다.
        taskId: body.taskId,
        projectId: body.projectId ?? project ?? DEFAULT_PROJECT_ID,
      });
      return send(res, outcome.accepted ? 202 : 200, outcome);
    }

    // 지금 돌고 있는 실행
    if (req.method === "GET" && path === "/runs") {
      return send(res, 200, { running: listRunning() });
    }

    // 중단된 실행을 대기열로 되돌린다 (전체)
    if (req.method === "POST" && path === "/recover") {
      const recovered = recoverAbandonedRuns();
      return send(res, 200, { recovered });
    }

    const taskMatch = /^\/tasks\/([^/]+)(\/state|\/result|\/reset)?$/.exec(path);
    if (taskMatch) {
      const [, taskId, sub] = taskMatch;
      const projectId = project ?? DEFAULT_PROJECT_ID;
      const task = readTask(taskId, projectId);
      if (!task) return send(res, 404, { error: `없는 작업입니다: ${taskId}` });

      if (req.method === "GET" && !sub) {
        return send(res, 200, { projectId, task, result: readResult(taskId, projectId) });
      }
      if (req.method === "POST" && sub === "/state") {
        const body = await readBody(req);
        const previous = readResult(taskId, projectId) ?? {};
        const record = writeResult({ ...previous, taskId, projectId, state: body.state });
        renderStatus(projectId);
        return send(res, 200, { result: record });
      }
      if (req.method === "POST" && sub === "/result") {
        const body = await readBody(req);
        const record = writeResult({ ...body, taskId, projectId });
        renderStatus(projectId);
        return send(res, 200, { result: record });
      }
      // 갇힌 작업 하나를 대기열로 되돌린다 — 중단된 실행의 복구 통로다.
      //
      // BLOCKED였다면 `decision` 으로 사람이 내린 답을 함께 넘긴다. 그 답은
      // 다음 실행의 지시문에 실려, 같은 자리에서 또 막히는 것을 막는다.
      if (req.method === "POST" && sub === "/reset") {
        const body = await readBody(req);
        const record = resetToRequested(taskId, body.reason, projectId, body.decision);
        renderStatus(projectId);
        return send(res, 200, { result: record });
      }
    }

    return send(res, 404, { error: `없는 경로입니다: ${path}` });
  } catch (error) {
    // 상태 계층이 거부한 것도 여기로 온다 — 400으로 정확히 알린다.
    return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CTO Bridge 서버: http://${HOST}:${PORT}`);
  console.log(TOKEN ? "  인증: 켜짐 (Bearer 토큰 필요)" : "  인증: 꺼짐 — 127.0.0.1에서만 접근 가능");

  // 서버가 다시 떴다는 것은 **이전 실행이 전부 죽었다**는 뜻이다.
  // Claude Code는 이 서버의 자식 프로세스라 서버와 함께 사라진다.
  // 되돌리지 않으면 그 작업은 IN_PROGRESS에 갇혀 다시는 실행되지 않는다.
  const recovered = recoverAbandonedRuns({ limitMs: -1 });
  for (const r of recovered) {
    console.log(`  복구: ${r.taskId} → REQUESTED (${r.reason})`);
  }
});

/**
 * ACOS Git Task Sync (T1-130)
 *
 * ## 왜 필요한가
 *
 * T1-128 실측: `agents/claude-chatbot-integration` 브랜치는 GitHub 원격에
 * 없고, 로컬 전용 커밋 2개 + 미커밋 변경 341건이 있다. 이 세션(비대화형
 * Claude Code)에서는 GitHub 인증 자체가 안 된다(T1-59, 이번 T1-130에서
 * `git push --dry-run`·`git credential fill`을 `GIT_TERMINAL_PROMPT=0`
 * 없이 실행하면 GCM이 대화형 프롬프트를 시도하며 무한 대기함을 재확인).
 *
 * 이 스크립트는 "검증 통과된 Task 단위"로만 자동 commit/push를 시도하고,
 * push가 안 되면(인증 미비·네트워크 문제) 로컬 커밋은 유지한 채 D: 큐에
 * 기록해 나중에 재시도한다. **341건은 절대 이 스크립트로 커밋하지 않는다**
 * — `--init`이 지금 시점의 READY_FOR_REVIEW/COMPLETED Task를 전부
 * "baseline-excluded"로 표시해 두어, 그 이후 새로 완료되는 Task만 대상이
 * 된다.
 *
 * ## 무엇을 하지 않는가
 *
 * - `git reset`·`git checkout`·`git clean`·`git pull`·`git stash` 등
 *   작업 트리를 되돌리거나 남의 변경을 덮어쓰는 명령은 전혀 쓰지 않는다.
 * - `bridge/` 아래 파일과 `apps/web/app/benchmark/constants.ts`는
 *   changedFiles에 있어도 자동 커밋 대상에서 제외한다(사람 승인 필요
 *   목록과 동일, AGENTS.md·이 작업 지시).
 * - 토큰/비밀번호를 코드나 환경변수 파일에 넣어 인증을 우회하지 않는다.
 *   Windows Git Credential Manager가 이미 설정돼 있고(`git config
 *   credential.helper` → `manager`), 사람이 대화형으로 한 번
 *   `git push`를 실행해 자격을 캐싱하면 그 다음부터는 이 스크립트가
 *   비대화형으로도 동작한다.
 *
 * ## 사용법
 *
 *   node scripts/git-task-sync.mjs --init               최초 1회, 지금
 *                                                        존재하는 미완료
 *                                                        변경을 baseline
 *                                                        으로 표시(git
 *                                                        상태를 바꾸지
 *                                                        않음)
 *   node scripts/git-task-sync.mjs --status              현재 큐·동기화
 *                                                        상태만 출력
 *   node scripts/git-task-sync.mjs --dry-run              무엇을 할지만
 *                                                        보여주고 아무것도
 *                                                        바꾸지 않음
 *   node scripts/git-task-sync.mjs --retry-queue-only    새 커밋을 만들지
 *                                                        않고, 이미 만든
 *                                                        로컬 커밋의 push만
 *                                                        재시도(재부팅
 *                                                        직후 호출에 안전)
 *   node scripts/git-task-sync.mjs                        전체 사이클:
 *                                                        큐 재시도 →
 *                                                        새 Task 스캔·
 *                                                        커밋·push 시도
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);

// ---- 저장 위치: D: 우선, 없으면(비정상 상황) 저장소 밖 임시 폴백 ----
// (scripts/acos-recovery-manager.ps1과 같은 폴백 원칙)
const D_ROOT = "D:\\dev-data\\git-sync";
const D_LOG_ROOT = "D:\\dev-data\\logs\\git-sync";
const usingFallback = !existsSync("D:\\");
// 테스트·특수 환경에서만 쓰는 override — 실 운영에서는 항상 D:(또는 그 폴백)를 쓴다.
const STATE_DIR = process.env.GIT_TASK_SYNC_STATE_DIR
  ? process.env.GIT_TASK_SYNC_STATE_DIR
  : usingFallback
    ? join(REPO, ".tmp", "git-sync")
    : D_ROOT;
const LOG_DIR = process.env.GIT_TASK_SYNC_LOG_DIR
  ? process.env.GIT_TASK_SYNC_LOG_DIR
  : usingFallback
    ? join(REPO, ".tmp", "git-sync-logs")
    : D_LOG_ROOT;

const SYNCED_FILE = join(STATE_DIR, "synced-tasks.json");
const QUEUE_FILE = join(STATE_DIR, "push-queue.json");
const LOG_FILE = join(LOG_DIR, "git-sync.log");
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_LOG_BACKUPS = 3;

// 절대 자동 커밋하지 않는 경로 — 사람 승인 없이 수정 금지 목록과 동일.
const NEVER_AUTO_COMMIT = [
  /^apps\/web\/app\/benchmark\/constants\.ts$/,
  /^bridge\//,
];

const ELIGIBLE_STATES = new Set(["READY_FOR_REVIEW", "COMPLETED"]);
const ACTIVE_STATES = new Set(["IN_PROGRESS", "TESTING", "REQUESTED"]);

// ---------------------------------------------------------------------------
// 기본 유틸
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJsonSafe(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // M-30 교훈 — 파일 하나가 깨져도(디스크 포화 등) 전체가 죽지 않는다.
    return fallback;
  }
}

function writeJsonAtomic(path, data) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}

function rotateLogIfNeeded() {
  if (!existsSync(LOG_FILE)) return;
  let size;
  try {
    size = statSync(LOG_FILE).size;
  } catch {
    return;
  }
  if (size < MAX_LOG_BYTES) return;
  const oldest = `${LOG_FILE}.${MAX_LOG_BACKUPS}`;
  if (existsSync(oldest)) {
    try {
      unlinkSync(oldest);
    } catch {
      /* 무시 */
    }
  }
  for (let i = MAX_LOG_BACKUPS - 1; i >= 1; i--) {
    const src = `${LOG_FILE}.${i}`;
    if (existsSync(src)) {
      try {
        renameSync(src, `${LOG_FILE}.${i + 1}`);
      } catch {
        /* 무시 */
      }
    }
  }
  try {
    renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    /* 무시 */
  }
}

function log(line) {
  const full = `${nowIso()} | ${line}`;
  console.log(full);
  try {
    ensureDir(LOG_DIR);
    rotateLogIfNeeded();
    writeFileSync(LOG_FILE, `${full}\n`, { flag: "a", encoding: "utf8" });
  } catch {
    // 로그 실패가 동기화 자체를 막지 않는다(T1-120과 같은 원칙).
  }
}

// ---------------------------------------------------------------------------
// git 헬퍼 — 전부 GIT_TERMINAL_PROMPT=0으로 비대화형 프롬프트를 원천 차단한다.
// (실측: 이 값이 없으면 GCM이 무한 대기한다 — T1-130)
// ---------------------------------------------------------------------------

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function gitSync(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    env: GIT_ENV,
    ...opts,
  });
}

/** 타임아웃이 있는 git 호출 — 예상치 못한 대화형 프롬프트가 남아 있어도
 * 스크립트 자체는 절대 무한 대기하지 않는다(2차 방어선). */
function gitWithTimeout(args, timeoutMs = 20000) {
  const r = spawnSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    env: GIT_ENV,
    timeout: timeoutMs,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    timedOut: r.signal === "SIGTERM" || r.error?.code === "ETIMEDOUT",
  };
}

function currentBranch() {
  return gitSync(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

function hasUpstream(branch) {
  const r = spawnSync(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{u}`],
    { cwd: REPO, encoding: "utf8", env: GIT_ENV },
  );
  return r.status === 0;
}

function porcelainStatus() {
  // --untracked-files=all — 새 디렉터리를 통째로 한 줄(`?? src/`)로 뭉치지
  // 않고 그 안의 파일 각각을 보여준다(실측으로 발견, T1-130). 이게 없으면
  // 새 폴더 안의 새 파일은 changedFiles와 매칭되지 않아 "diff 없음"으로
  // 잘못 건너뛴다.
  const out = gitSync(["status", "--porcelain", "--untracked-files=all"]);
  const map = new Map();
  for (const rawLine of out.split(/\r?\n/)) {
    if (!rawLine) continue;
    const code = rawLine.slice(0, 2);
    let file = rawLine.slice(3);
    if (file.includes(" -> ")) file = file.split(" -> ")[1];
    map.set(file.trim(), code);
  }
  return map;
}

function classifyFailure(stderr) {
  const s = stderr.toLowerCase();
  if (
    s.includes("terminal prompts disabled") ||
    s.includes("could not read username") ||
    s.includes("authentication failed") ||
    s.includes("403") ||
    s.includes("permission denied (publickey)") ||
    s.includes("user interactivity has been disabled")
  ) {
    return "auth";
  }
  if (
    s.includes("could not resolve host") ||
    s.includes("failed to connect") ||
    s.includes("timed out") ||
    s.includes("network is unreachable") ||
    s.includes("connection reset")
  ) {
    return "network";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// bridge/results 읽기 (읽기 전용 — bridge/ 안의 어떤 파일도 고치지 않는다)
// ---------------------------------------------------------------------------

function listResultTasks() {
  const dir = join(REPO, "bridge", "results");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const data = readJsonSafe(join(dir, name), null);
    if (!data || !data.taskId) continue; // 깨진 파일은 건너뛴다(M-30)
    out.push(data);
  }
  return out;
}

function readTaskTitle(taskId) {
  const data = readJsonSafe(join(REPO, "bridge", "tasks", `${taskId}.json`), null);
  return data?.title ?? null;
}

function testResultsAllOk(testResults) {
  if (!testResults || typeof testResults !== "object") return false;
  const required = ["build", "typecheck", "lint", "tests"];
  return required.every((k) => testResults[k] && testResults[k].ok === true);
}

// ---------------------------------------------------------------------------
// 상태 파일
// ---------------------------------------------------------------------------

function loadSyncState() {
  return readJsonSafe(SYNCED_FILE, {});
}

function saveSyncState(state) {
  writeJsonAtomic(SYNCED_FILE, state);
}

function loadQueue() {
  return readJsonSafe(QUEUE_FILE, {});
}

function saveQueue(queue) {
  writeJsonAtomic(QUEUE_FILE, queue);
}

// ---------------------------------------------------------------------------
// 비밀값 검사 — bridge/check-secrets.mjs를 그대로 호출한다(수정하지 않음).
// 이미 git add된(스테이징된) 파일만 검사하는 기본 모드를 쓴다.
// ---------------------------------------------------------------------------

function checkSecretsOnStaged() {
  const r = spawnSync("node", [join(REPO, "bridge", "check-secrets.mjs")], {
    cwd: REPO,
    encoding: "utf8",
  });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ---------------------------------------------------------------------------
// push 재시도 큐
// ---------------------------------------------------------------------------

function attemptPush(branch) {
  if (!hasUpstream(branch)) {
    return gitWithTimeout(["push", "-u", "origin", branch], 25000);
  }
  return gitWithTimeout(["push", "origin", branch], 25000);
}

function retryQueue({ dryRun }) {
  const queue = loadQueue();
  const branch = currentBranch();
  const entry = queue[branch];
  if (!entry) {
    log(`큐 재시도 — ${branch}: 대기 중인 push 없음`);
    return { attempted: false };
  }
  log(
    `큐 재시도 — ${branch}: 이전 실패(${entry.lastErrorKind ?? "unknown"}) 이후 재시도 (attempts=${entry.attempts ?? 0})`,
  );
  if (dryRun) {
    log(`[dry-run] 실제 push는 실행하지 않음`);
    return { attempted: false, dryRun: true };
  }
  const result = attemptPush(branch);
  entry.attempts = (entry.attempts ?? 0) + 1;
  entry.lastAttemptAt = nowIso();
  if (result.ok) {
    const sha = gitSync(["rev-parse", "HEAD"]).trim();
    log(`큐 재시도 성공 — ${branch} push 완료, remote SHA=${sha}`);
    delete queue[branch];
    saveQueue(queue);
    markQueuedTasksPushed(branch, sha);
    return { attempted: true, ok: true, sha };
  }
  const kind = result.timedOut ? "timeout" : classifyFailure(result.stderr);
  entry.lastError = result.stderr.trim().slice(0, 500) || (result.timedOut ? "타임아웃" : "알 수 없는 오류");
  entry.lastErrorKind = kind;
  queue[branch] = entry;
  saveQueue(queue);
  log(`큐 재시도 실패 — ${branch}: kind=${kind} detail=${entry.lastError}`);
  return { attempted: true, ok: false, kind };
}

function markQueuedTasksPushed(branch, sha) {
  const state = loadSyncState();
  let changed = false;
  for (const [taskId, rec] of Object.entries(state)) {
    if (rec.branch === branch && rec.status === "committed-local") {
      rec.status = "pushed";
      rec.remoteSha = sha;
      rec.pushedAt = nowIso();
      changed = true;
      log(`  ↳ ${taskId} push 반영 확인`);
    }
  }
  if (changed) saveSyncState(state);
}

// ---------------------------------------------------------------------------
// --init — 지금 존재하는 완료 Task를 baseline-excluded로만 표시한다.
// git 상태는 전혀 건드리지 않는다(요청 9번 그대로).
// ---------------------------------------------------------------------------

function runInit() {
  const tasks = listResultTasks();
  const state = loadSyncState();
  let marked = 0;
  for (const t of tasks) {
    if (!ELIGIBLE_STATES.has(t.state)) continue;
    if (state[t.taskId]) continue; // 이미 기록됨
    state[t.taskId] = {
      status: "baseline-excluded",
      reason: "T1-130 도입 이전부터 있던 변경 — 자동 동기화 대상에서 제외, 사람이 별도로 처리",
      state: t.state,
      recordedAt: nowIso(),
    };
    marked += 1;
  }
  saveSyncState(state);
  log(`--init 완료 — baseline-excluded로 표시한 Task ${marked}건 (총 기록 ${Object.keys(state).length}건)`);
  log(`  이 Task들은 자동 commit/push 대상이 아니다 — 사람이 별도로 처리해야 한다.`);
  return marked;
}

// ---------------------------------------------------------------------------
// 메인 동기화 — 새로 자격을 갖춘 Task를 찾아 Task 단위로 commit/push한다.
// ---------------------------------------------------------------------------

function eligibleNewTasks() {
  const tasks = listResultTasks();
  const state = loadSyncState();
  const activeFiles = new Set();
  for (const t of tasks) {
    if (ACTIVE_STATES.has(t.state) && Array.isArray(t.changedFiles)) {
      for (const f of t.changedFiles) activeFiles.add(f);
    }
  }
  const out = [];
  for (const t of tasks) {
    if (!ELIGIBLE_STATES.has(t.state)) continue;
    if (state[t.taskId]) continue; // 이미 처리(또는 baseline-excluded)
    out.push({ task: t, activeFiles });
  }
  return out;
}

function filterCommittableFiles(changedFiles, statusMap) {
  const kept = [];
  const skippedNoDiff = [];
  const skippedNeverCommit = [];
  for (const f of changedFiles ?? []) {
    if (NEVER_AUTO_COMMIT.some((re) => re.test(f))) {
      skippedNeverCommit.push(f);
      continue;
    }
    if (!statusMap.has(f)) {
      skippedNoDiff.push(f);
      continue;
    }
    kept.push(f);
  }
  return { kept, skippedNoDiff, skippedNeverCommit };
}

function buildCommitMessage(task) {
  const title = readTaskTitle(task.taskId) ?? "(제목 없음)";
  const workDoneLines = Array.isArray(task.workDone) && task.workDone.length
    ? task.workDone.map((w) => `- ${w}`).join("\n")
    : "- (workDone 기록 없음)";
  return [
    `chore: ${title} (Task ${task.taskId})`,
    "",
    workDoneLines,
    "",
    "검증: build/typecheck/lint/tests 전부 ok (scripts/git-task-sync.mjs 자동 확인, T1-130)",
    "",
    "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>",
  ].join("\n");
}

function syncOneTask({ task, activeFiles }, { dryRun }) {
  const taskId = task.taskId;

  if (!testResultsAllOk(task.testResults)) {
    log(`SKIP ${taskId} — 검증 미통과(build/typecheck/lint/tests 중 ok:true가 아닌 항목 있음)`);
    return null;
  }
  if (!Array.isArray(task.changedFiles) || task.changedFiles.length === 0) {
    log(`SKIP ${taskId} — changedFiles 없음`);
    return null;
  }

  const collision = task.changedFiles.filter((f) => activeFiles.has(f));
  if (collision.length > 0) {
    log(`SKIP ${taskId} (이번 실행) — 진행 중인 다른 Task와 파일 겹침: ${collision.join(", ")}. 다음 실행에서 재시도.`);
    return null;
  }

  const statusMap = porcelainStatus();
  const { kept, skippedNoDiff, skippedNeverCommit } = filterCommittableFiles(task.changedFiles, statusMap);

  if (skippedNeverCommit.length > 0) {
    log(`  ${taskId}: 자동 커밋 제외 목록이라 건너뜀 — ${skippedNeverCommit.join(", ")}`);
  }
  if (skippedNoDiff.length > 0) {
    log(`  ${taskId}: 이미 커밋됐거나 변경 없음 — ${skippedNoDiff.join(", ")}`);
  }
  if (kept.length === 0) {
    log(`SKIP ${taskId} — 실제로 커밋할 파일 없음(전부 제외되거나 diff 없음)`);
    const state = loadSyncState();
    state[taskId] = {
      status: "no-diff",
      reason: "changedFiles 전부 제외 대상이거나 이미 커밋됨",
      recordedAt: nowIso(),
    };
    saveSyncState(state);
    return null;
  }

  if (dryRun) {
    log(`[dry-run] ${taskId} — 커밋 대상 ${kept.length}개: ${kept.join(", ")}`);
    return { taskId, dryRun: true, files: kept };
  }

  // ---- git add ----
  gitSync(["add", "--", ...kept]);

  // ---- 비밀값 검사 (스테이징된 파일만) ----
  const secretsCheck = checkSecretsOnStaged();
  if (!secretsCheck.ok) {
    gitSync(["reset", "HEAD", "--", ...kept]); // 스테이징만 되돌린다 — 작업 트리는 그대로
    log(`BLOCKED ${taskId} — 비밀값 검사 실패, 커밋하지 않음. 사람이 직접 확인 필요.\n${secretsCheck.output}`);
    const state = loadSyncState();
    state[taskId] = {
      status: "blocked-secrets",
      reason: "check-secrets.mjs가 잠재적 비밀값을 발견함 — 자동 커밋 보류",
      recordedAt: nowIso(),
    };
    saveSyncState(state);
    return null;
  }

  // ---- 커밋 ----
  const message = buildCommitMessage(task);
  gitSync(["commit", "-m", message]);
  const localSha = gitSync(["rev-parse", "HEAD"]).trim();
  log(`COMMIT ${taskId} — ${localSha.slice(0, 12)} (${kept.length}개 파일)`);

  const branch = currentBranch();
  const state = loadSyncState();
  state[taskId] = {
    status: "committed-local",
    branch,
    localSha,
    files: kept,
    committedAt: nowIso(),
  };
  saveSyncState(state);

  // ---- push 시도 ----
  const pushResult = attemptPush(branch);
  if (pushResult.ok) {
    const sha = gitSync(["rev-parse", "HEAD"]).trim();
    state[taskId].status = "pushed";
    state[taskId].remoteSha = sha;
    state[taskId].pushedAt = nowIso();
    saveSyncState(state);
    log(`PUSH ${taskId} 성공 — ${branch} remote SHA=${sha}`);
    const queue = loadQueue();
    delete queue[branch];
    saveQueue(queue);
    return { taskId, ok: true, pushed: true, sha };
  }

  const kind = pushResult.timedOut ? "timeout" : classifyFailure(pushResult.stderr);
  const detail = pushResult.stderr.trim().slice(0, 500) || (pushResult.timedOut ? "타임아웃" : "알 수 없는 오류");
  log(`PUSH ${taskId} 실패(로컬 커밋은 유지) — kind=${kind} detail=${detail}`);
  const queue = loadQueue();
  queue[branch] = {
    queuedAt: queue[branch]?.queuedAt ?? nowIso(),
    lastAttemptAt: nowIso(),
    attempts: (queue[branch]?.attempts ?? 0) + 1,
    lastError: detail,
    lastErrorKind: kind,
    localHeadSha: localSha,
  };
  saveQueue(queue);
  return { taskId, ok: true, pushed: false, kind };
}

// ---------------------------------------------------------------------------
// 상태 출력
// ---------------------------------------------------------------------------

function printStatus() {
  const state = loadSyncState();
  const queue = loadQueue();
  const counts = {};
  for (const rec of Object.values(state)) {
    counts[rec.status] = (counts[rec.status] ?? 0) + 1;
  }
  console.log(`상태 저장 위치: ${STATE_DIR}${usingFallback ? " (D: 없음 — 저장소 안 폴백 사용 중)" : ""}`);
  console.log(`로그 위치: ${LOG_DIR}`);
  console.log(`동기화 기록 총 ${Object.keys(state).length}건:`);
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${status}: ${count}건`);
  }
  console.log(`push 대기 큐: ${Object.keys(queue).length}건`);
  for (const [branch, entry] of Object.entries(queue)) {
    console.log(`  ${branch} — attempts=${entry.attempts} lastErrorKind=${entry.lastErrorKind} lastAttemptAt=${entry.lastAttemptAt}`);
  }
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  if (args.includes("--status")) {
    printStatus();
    return;
  }

  if (args.includes("--init")) {
    runInit();
    return;
  }

  ensureDir(STATE_DIR);
  ensureDir(LOG_DIR);

  log(`=== git-task-sync 시작 (branch=${currentBranch()}, dryRun=${dryRun}) ===`);

  // 1) 이미 만든 로컬 커밋의 push부터 재시도한다(새 커밋보다 먼저).
  retryQueue({ dryRun });

  if (args.includes("--retry-queue-only")) {
    log(`=== git-task-sync 종료(--retry-queue-only) ===`);
    return;
  }

  // 2) 새로 자격을 갖춘 Task를 찾아 처리한다.
  const candidates = eligibleNewTasks();
  if (candidates.length === 0) {
    log(`새로 동기화할 Task 없음`);
  }
  for (const c of candidates) {
    try {
      syncOneTask(c, { dryRun });
    } catch (err) {
      log(`ERROR ${c.task.taskId} 처리 중 예외: ${err?.message ?? err}`);
    }
  }

  log(`=== git-task-sync 종료 ===`);
}

main();

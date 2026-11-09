#!/usr/bin/env node
/**
 * 세션/프로세스 재시작 후 컨텍스트 복구 부트스트랩 (T1-107)
 *
 *   node scripts/bootstrap-context.mjs
 *
 * 목적: 재부팅·VS Code 재실행·Claude Code 프로세스 재시작으로 새
 * 세션이 시작됐을 때, 이전 대화 없이도 "지금 무슨 작업이 어디까지
 * 진행됐는가"를 파악할 수 있게 한다. 새 기억 저장소를 만들지 않는다
 * — bridge/tasks(지시)·bridge/results(실행 상태·결과)·git 상태·
 * 공식 문서 7종을 그대로 읽어 보여주기만 한다(docs/RECOVERY_GUIDE.md
 * "세션 복구" 절과 짝을 이룬다).
 *
 * 읽기 전용이다. 어떤 파일도 쓰지 않고, 어떤 Task도 실행·재개하지
 * 않는다. bridge/ 아래 파일은 읽기만 한다 — 고치지 않는다.
 *
 * 순서(요청 원문과 동일): 현재 프로젝트 상태 → Bridge health →
 * taskId/실행 상태 → 최근 Task 결과 → 변경 파일/git 상태 →
 * 장기기억 문서 → 작업 로그.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// bridge/bridge-executor.mjs의 ABANDON_LIMIT_MS(5분)와 같은 값을 쓴다 —
// import하지 않고 값만 복제했다. 이 스크립트는 bridge/ 코드에 전혀
// 의존하지 않아야 재시작 직후·Bridge가 안 떠 있어도 항상 돌 수 있다.
// 값이 바뀌면 이 주석과 함께 갱신해야 한다(2026-08-13 기준 5 * 60 * 1000).
const ABANDON_LIMIT_MS = 5 * 60 * 1000;

const LONG_TERM_DOCS = [
  "docs/RECOVERY_GUIDE.md",
  "docs/MASTER_GUIDE.md",
  "AGENTS.md",
  "docs/DEVELOPMENT_ENVIRONMENT.md",
  "docs/PROJECT_STATE.md",
  "TASKS.md",
  "docs/PROJECT_MEMORY.md",
];

function section(title) {
  console.log(`\n== ${title} ==`);
}

function safeGit(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (error) {
    return `(git 명령 실패: ${error.message.split("\n")[0]})`;
  }
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function listResultTasks() {
  const dir = join(ROOT, "bridge", "results");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJsonSafe(join(dir, f)))
    .filter(Boolean);
}

function readTaskInstruction(taskId) {
  const path = join(ROOT, "bridge", "tasks", `${taskId}.json`);
  return readJsonSafe(path);
}

function summarize(text, max = 200) {
  if (typeof text !== "string") return "(지시 원문 없음)";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

console.log("ACOS 세션 부트스트랩 — 읽기 전용, 아무 Task도 실행하지 않습니다.");
console.log(`실행 시각: ${new Date().toISOString()}`);

// 1. 현재 프로젝트 상태 (docs/PROJECT_STATE.md 최상단 = 가장 최근 기록)
section("1. 현재 프로젝트 상태 (docs/PROJECT_STATE.md 최상단)");
const statePath = join(ROOT, "docs", "PROJECT_STATE.md");
if (existsSync(statePath)) {
  const lines = readFileSync(statePath, "utf8").split("\n");
  // 첫 "## " 제목(최신 항목)까지 헤더 + 제목 한 줄만 미리보기로 보여준다.
  const firstHeadingIdx = lines.findIndex((l, i) => i > 0 && l.startsWith("## "));
  const preview = lines.slice(0, firstHeadingIdx > 0 ? firstHeadingIdx + 1 : 12).join("\n");
  console.log(preview);
  console.log("(전체는 docs/PROJECT_STATE.md를 직접 읽는다 — 여기는 미리보기만)");
} else {
  console.log("docs/PROJECT_STATE.md 를 찾지 못했습니다.");
}

// 2. Bridge health — 서버가 안 떠 있어도 이 스크립트는 계속 진행한다.
section("2. Bridge health (127.0.0.1:4200)");
try {
  const res = await fetch("http://127.0.0.1:4200/health", { signal: AbortSignal.timeout(3000) });
  console.log(`GET /health -> HTTP ${res.status}`);
} catch (error) {
  console.log(`Bridge 서버에 연결할 수 없습니다 (${error.message}). 문서·bridge/results 파일만으로 복원을 계속합니다.`);
}

// 3~4. taskId/실행 상태 + 최근 Task 결과 (bridge/results/*.json)
section("3. Task 실행 상태 (bridge/results/*.json)");
const tasks = listResultTasks().sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0));
const now = Date.now();

const runningNow = [];
const resumeCandidates = [];
const awaitingReview = [];

for (const t of tasks) {
  const isActive = t.state === "IN_PROGRESS" || t.state === "TESTING";
  if (!isActive) continue;
  const heartbeatMs = t.heartbeatAt ? new Date(t.heartbeatAt).getTime() : 0;
  const staleMs = now - heartbeatMs;
  if (heartbeatMs && staleMs < ABANDON_LIMIT_MS) {
    runningNow.push({ ...t, staleMs });
  } else {
    resumeCandidates.push({ ...t, staleMs });
  }
}
for (const t of tasks) {
  if (t.state === "READY_FOR_REVIEW" || t.state === "BLOCKED" || t.state === "DECISION_NEEDED") {
    awaitingReview.push(t);
  }
}

console.log(`전체 ${tasks.length}건 — IN_PROGRESS/TESTING ${runningNow.length + resumeCandidates.length}건, ` +
  `RESUME CANDIDATE ${resumeCandidates.length}건, 사람/CTO 확인 대기 ${awaitingReview.length}건`);

if (runningNow.length > 0) {
  console.log("\n[지금 다른 프로세스가 실행 중일 수 있음 — 건드리지 않는다]");
  for (const t of runningNow) {
    console.log(`  ${t.taskId}  ${t.state}  heartbeat ${Math.round(t.staleMs / 1000)}초 전  pid ${t.pid ?? "?"}`);
  }
}

if (resumeCandidates.length > 0) {
  console.log("\n[RESUME CANDIDATE — heartbeat가 5분 이상 끊김, 프로세스가 죽었을 가능성]");
  console.log("주의: 이 목록에 있다고 자동으로 재실행하지 않는다. CTO/사람이 taskId를 지정해야만 재개한다.");
  for (const t of resumeCandidates) {
    const instr = readTaskInstruction(t.taskId);
    console.log(`\n  taskId: ${t.taskId}`);
    console.log(`    state: ${t.state} (heartbeat ${Math.round(t.staleMs / 60000)}분 전, pid ${t.pid ?? "?"})`);
    console.log(`    제목: ${instr?.title ?? "(bridge/tasks/*.json 없음)"}`);
    console.log(`    지시 요약: ${summarize(instr?.request)}`);
    console.log(`    변경 파일: ${(t.changedFiles ?? []).length}건 ${JSON.stringify(t.changedFiles ?? [])}`);
    console.log(`    blockedOn: ${t.blockedOn ?? "없음"}`);
    console.log(`    decisionNeeded: ${t.decisionNeeded ? JSON.stringify(t.decisionNeeded) : "없음"}`);
  }
} else {
  console.log("\nRESUME CANDIDATE 없음 — 죽은 채 방치된 IN_PROGRESS/TESTING 작업이 없습니다.");
}

section("4. 최근 완료·검토대기 Task 결과 (최신순 5건)");
const recent = tasks
  .filter((t) => ["COMPLETED", "READY_FOR_REVIEW", "BLOCKED", "DECISION_NEEDED"].includes(t.state))
  .slice(0, 5);
for (const t of recent) {
  const wd = Array.isArray(t.workDone) ? t.workDone.length : 0;
  const tr = t.testResults
    ? Object.entries(t.testResults).map(([k, v]) => `${k}:${v?.ok === true ? "OK" : v?.ok === false ? "FAIL" : "?"}`).join(" ")
    : "(testResults 없음)";
  console.log(`  ${t.taskId}  ${t.state}  workDone ${wd}건  ${tr}`);
}

// 5. 변경 파일 / git 상태
section("5. git 상태");
console.log(`브랜치: ${safeGit(["branch", "--show-current"])}`);
console.log(`최근 커밋: ${safeGit(["log", "-1", "--format=%h %cI %s"])}`);
const status = safeGit(["status", "--porcelain"]);
const statusLines = status ? status.split("\n") : [];
console.log(`미커밋 변경: ${statusLines.length}건${statusLines.length > 0 ? " (앞 20건)" : ""}`);
for (const line of statusLines.slice(0, 20)) console.log(`  ${line}`);
if (statusLines.length > 20) console.log(`  … 외 ${statusLines.length - 20}건`);

// 6. 장기기억 문서 포인터 (내용은 각자 읽는다 — 여기서는 최신성만 보여준다)
section("6. 장기기억 문서 (최근 갱신 커밋 기준, 이 순서로 읽는다)");
for (const doc of LONG_TERM_DOCS) {
  const exists = existsSync(join(ROOT, doc));
  const lastCommit = exists ? safeGit(["log", "-1", "--format=%cI %s", "--", doc]) : "(파일 없음)";
  console.log(`  ${doc}  ${lastCommit}`);
}

// 7. 작업 로그 (bridge/STATUS.md — 자동 생성, 사람이 손으로 고치지 않음)
section("7. 작업 로그 (bridge/STATUS.md)");
const statusMdPath = join(ROOT, "bridge", "STATUS.md");
if (existsSync(statusMdPath)) {
  const head = readFileSync(statusMdPath, "utf8").split("\n").slice(0, 5).join("\n");
  console.log(head);
  console.log("(전체는 bridge/STATUS.md 또는 `node bridge/bridge-cli.mjs status` 참고)");
} else {
  console.log("bridge/STATUS.md 를 찾지 못했습니다.");
}

section("다음 행동");
console.log("- RESUME CANDIDATE가 있어도 스스로 재실행하지 않는다.");
console.log("- 이 프로세스가 '지금 이 세션'이 어느 taskId인지 스스로 알 방법은 없다");
console.log("  (Bridge가 claude.exe를 실행할 때 taskId를 프로세스 환경변수로 넘기지 않는다 —");
console.log("   실측: bridge/bridge-executor.mjs의 claudeSpawnOptions). 호출 프롬프트에 적힌");
console.log("  taskId를 그대로 신뢰한다.");
console.log("- 지정된 taskId 하나만 다시 진행하고, 대기열의 다른 REQUESTED 작업은 건드리지 않는다.");

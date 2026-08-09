/**
 * CTO Bridge 비동기 실행 검사 — Cloudflare 524 재발 방지.
 *
 * **여기서 확인하는 것은 "실행이 성공한다"가 아니다.** 확인하는 것은
 * **"요청이 실행을 기다리지 않는다"** 이다. 기다리는 순간 524가 다시 난다.
 *
 * ## 어떻게 격리하는가
 *
 * `bridge-io.mjs`는 자기 파일 위치를 기준으로 `tasks/`·`results/`를 찾는다.
 * 그래서 검사는 Bridge 모듈들을 **임시 폴더에 복사해서** 부른다 — 진짜
 * 작업(T1-21~T1-26)을 건드리지 않기 위해서다.
 *
 * ## 왜 진짜 Claude를 부르지 않는가
 *
 * 검사가 돌 때마다 요금이 나가면 안 된다. `CLAUDE_CODE_BIN`을 **빨리 끝나는
 * 무해한 실행 파일**로 바꿔 둔다. 호출 자체는 진짜로 일어나고(spawn),
 * 응답만 Claude의 것이 아니다.
 *
 * 실행: node bridge/bridge-async.spec.mjs
 */

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  실패 ${name}`);
    console.log(`       ${error.message}`);
  }
}

console.log("CTO Bridge — 비동기 실행 검사\n");

// 요금이 나가지 않도록 **진짜 Claude가 아닌** 실행 파일을 쓴다.
// where.exe 는 어디에나 있고, 이상한 인자를 주면 곧바로 끝난다.
const harmless = "C:\\Windows\\System32\\where.exe";
if (!existsSync(harmless)) {
  console.log("  건너뜀 — 대체 실행 파일이 없습니다.");
  process.exit(0);
}
process.env.CLAUDE_CODE_BIN = harmless;

// Bridge 모듈을 임시 폴더로 복사한다 — 진짜 작업 폴더를 건드리지 않는다.
const sandbox = mkdtempSync(join(tmpdir(), "bridge-spec-"));
for (const file of [
  "bridge-io.mjs",
  "bridge-state.mjs",
  "bridge-executor.mjs",
  // bridge-io.mjs·bridge-executor.mjs가 프로젝트 계층을 쓴다(2026-08-09
  // 다중 프로젝트 지원). 빠뜨리면 샌드박스에서 "모듈을 찾을 수 없음"으로
  // 즉시 죽는다 — 실측으로 확인했다.
  "bridge-projects.mjs",
]) {
  cpSync(join(HERE, file), join(sandbox, file));
}

const io = await import(pathToFileURL(join(sandbox, "bridge-io.mjs")).href);
const exec = await import(pathToFileURL(join(sandbox, "bridge-executor.mjs")).href);
const projects = await import(pathToFileURL(join(sandbox, "bridge-projects.mjs")).href);

io.createTask({ taskId: "SPEC-1", title: "비동기 검사용", request: "아무것도 하지 않는다" });

let firstRun;

await test("실행 요청은 **기다리지 않는다** — Promise가 아니라 결과가 즉시 나온다", () => {
  const before = Date.now();
  firstRun = exec.startNextTask({ cwd: sandbox });
  const spent = Date.now() - before;

  // 이것이 524 대책의 전부다. Promise를 돌려주면 서버가 await 하게 되고,
  // 그 순간 응답이 Claude 호출만큼 늦어진다.
  assert.equal(typeof firstRun.then, "undefined", "startNextTask가 Promise를 돌려주면 안 된다");
  assert.equal(firstRun.accepted, true);
  assert.ok(spent < 2000, `즉시 돌아와야 한다 (${spent}ms 걸림)`);
});

await test("응답에 taskId·runId·조회 방법이 들어 있다", () => {
  assert.equal(firstRun.taskId, "SPEC-1");
  assert.ok(firstRun.runId, "실행 식별자가 있어야 한다");
  assert.equal(firstRun.state, "IN_PROGRESS");
  assert.ok(firstRun.pollWith.includes("SPEC-1"), "무엇으로 조회하는지 알려 줘야 한다");
});

await test("응답 직후 상태를 조회하면 이미 IN_PROGRESS다 — 뒤에서 돌고 있다는 뜻", () => {
  assert.equal(io.readResult("SPEC-1").state, "IN_PROGRESS");
  assert.equal(exec.listRunning().length, 1);
});

await test("같은 작업을 두 번 실행하지 않는다", () => {
  const second = exec.startNextTask({ cwd: sandbox });
  assert.equal(second.accepted, false);
  assert.ok(second.reason.includes("SPEC-1") || second.reason.includes("없습니다"));
});

await test("실행이 끝나면 목록에서 빠지고 상태가 남는다", async () => {
  await exec.waitForRun(firstRun.runId);
  assert.equal(exec.listRunning().length, 0);
  const after = io.readResult("SPEC-1").state;
  assert.ok(after !== "IN_PROGRESS", `IN_PROGRESS에 갇히면 안 된다 (지금 ${after})`);
});

await test("dryRun은 작업을 소비하지 않는다 (실측 결함, 2026-08-09)", () => {
  io.createTask({ taskId: "SPEC-2", title: "dryRun 검사", request: "확인만 한다" });
  const dry = exec.startNextTask({ cwd: sandbox, dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.taskId, "SPEC-2");
  assert.ok(dry.prompt.includes("SPEC-2"));
  // 상태가 바뀌지 않아야 한다 — 프롬프트만 보려고 부른 것이다.
  assert.equal(io.readResult("SPEC-2"), null);
});

await test("중단된 실행은 대기열로 되돌아온다 — 갇힌 작업을 푸는 유일한 길", () => {
  // 죽은 서버가 남긴 것처럼 위조한다: IN_PROGRESS인데 아무도 안 돌리고 있다.
  io.writeResult({
    taskId: "SPEC-2",
    state: "IN_PROGRESS",
    runId: "죽은-실행",
    startedAt: "2020-01-01T00:00:00.000Z",
    heartbeatAt: "2020-01-01T00:00:00.000Z",
  });
  const recovered = exec.recoverAbandonedRuns();
  assert.ok(
    recovered.some((r) => r.taskId === "SPEC-2"),
    "되돌리지 않으면 그 작업은 영원히 실행되지 않는다",
  );
  assert.equal(io.readResult("SPEC-2").state, "REQUESTED");
  assert.ok(io.readResult("SPEC-2").blockedOn, "왜 되돌아왔는지 남아야 한다");
});

await test("되돌아온 작업은 다시 실행할 수 있다", () => {
  const again = exec.startNextTask({ cwd: sandbox });
  assert.equal(again.accepted, true);
  assert.equal(again.taskId, "SPEC-2");
});

await test("TESTING에 멈춘 작업도 되돌릴 수 있다 (실측, T1-22·T1-23)", async () => {
  await exec.waitForRun(exec.listRunning()[0]?.runId ?? "");
  io.createTask({ taskId: "SPEC-3", title: "TESTING 복구", request: "확인" });
  io.writeResult({ taskId: "SPEC-3", state: "IN_PROGRESS" });
  io.writeResult({ taskId: "SPEC-3", state: "TESTING" });

  const record = io.resetToRequested("SPEC-3", "검증 기록이 게이트를 통과하지 못했습니다.");
  assert.equal(record.state, "REQUESTED");
  assert.ok(record.blockedOn, "왜 되돌아왔는지 남아야 한다");
});

/* ---- 무인 실행 정책: 사람이 자리에 없어도 멈추지 않는다 ---- */

await test("승인 창이 뜨지 않도록 권한 옵션을 준다", () => {
  const args = exec.buildClaudeArgs("아무 지시");
  assert.ok(args.includes("--dangerously-skip-permissions"), "권한 확인을 건너뛰어야 한다");
  const modeAt = args.indexOf("--permission-mode");
  assert.ok(modeAt >= 0 && args[modeAt + 1] === "bypassPermissions", "권한 모드를 못 박아야 한다");
  assert.ok(args.includes("-p"), "대화형이 아니라 한 번 실행이어야 한다");
});

await test("출력이 흘러나오는 형식을 쓴다 — 안 그러면 정지를 감지할 수 없다", () => {
  const args = exec.buildClaudeArgs("아무 지시");
  const at = args.indexOf("--output-format");
  assert.equal(args[at + 1], "stream-json", "끝에 한 번만 나오는 형식이면 진행을 볼 수 없다");
});

await test("스트리밍 출력에서 마지막 결과만 뽑는다", () => {
  const stream = [
    "신뢰 대화상자 경고 같은 잡음",
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "assistant", message: { content: "작업 중" } }),
    "{깨진 줄",
    JSON.stringify({ type: "result", result: "끝났다 RESULT_JSON: {}", total_cost_usd: 1.5 }),
  ].join("\n");
  const parsed = exec.parseStreamJson(stream);
  assert.equal(parsed.type, "result");
  assert.equal(parsed.total_cost_usd, 1.5);
  assert.ok(parsed.result.includes("끝났다"));
});

await test("결과 이벤트가 없으면 null — 원문으로 되돌아갈 수 있어야 한다", () => {
  assert.equal(exec.parseStreamJson("아무 말"), null);
  assert.equal(exec.parseStreamJson(JSON.stringify({ type: "assistant" })), null);
  assert.equal(exec.parseStreamJson(null), null);
});

await test("표준입력을 닫는다 — 열어 두면 입력을 기다리다 영영 멈춘다", () => {
  const opts = exec.claudeSpawnOptions("C:\\repo");
  assert.deepEqual(opts.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(opts.cwd, "C:\\repo");
});

await test("아무도 안 볼 때 비용이 무한정 늘지 않도록 상한을 준다", () => {
  const args = exec.buildClaudeArgs("아무 지시");
  const at = args.indexOf("--max-budget-usd");
  assert.ok(at >= 0, "비용 상한이 있어야 한다");
  assert.ok(Number(args[at + 1]) > 0);
});

await test("멈추는 한계값이 정해져 있다 — 전체 시간과 무응답 시간 둘 다", () => {
  assert.ok(exec.RUN_TIMEOUT_MS > 0);
  assert.ok(exec.STALL_LIMIT_MS > 0);
  // 무응답 한계가 전체 한계보다 커지면 조용한 정지를 잡지 못한다.
  assert.ok(exec.STALL_LIMIT_MS < exec.RUN_TIMEOUT_MS);
});

// doNotTouch는 이제 코드에 박혀 있지 않고 **프로젝트 등록 정보에서** 온다
// (2026-08-09, 다중 프로젝트 지원). 그래서 프롬프트를 만들 때 실제 등록
// 정보를 함께 넘겨야 하고, 넘기지 않으면(=프로젝트를 모르면) 건드리면
// 안 되는 것도 비어 있다 — 그 자체가 프로젝트 격리가 실제로 동작한다는
// 증거다.
const defaultProject = projects.readProject(projects.DEFAULT_PROJECT_ID);

await test("지시문이 '사람에게 묻지 말라'고 못 박는다", () => {
  const prompt = exec.buildPrompt({ taskId: "T9-9", title: "제목", request: "요청" }, defaultProject);
  assert.ok(prompt.includes("사람은 자리에 없다"), "무인 전제를 알려야 한다");
  assert.ok(prompt.includes("묻지 않는다"));
  assert.ok(prompt.includes("blockedOn"), "막히면 멈추지 말고 적고 끝내야 한다");
  // 건드리면 안 되는 것도 지시문에 실려 있어야 한다 — 문서에만 적으면
  // 호출된 세션이 문서를 읽기 전에 이미 파일을 고칠 수 있다.
  assert.ok(prompt.includes("benchmark/constants.ts"));
  assert.ok(prompt.includes("bridge/"));
});

await test("프로젝트를 안 주면 그 프로젝트의 doNotTouch만 실린다 — 다른 프로젝트 규칙이 섞이지 않는다", () => {
  const otherProject = {
    projectId: "other-demo",
    name: "다른 프로젝트",
    docs: ["OTHER_DOC.md"],
    doNotTouch: ["OTHER_SECRET.env (다른 프로젝트만의 규칙)"],
    verifyCommands: ["npm test"],
  };
  const prompt = exec.buildPrompt({ taskId: "T9-9", title: "제목", request: "요청" }, otherProject);
  assert.ok(prompt.includes("OTHER_DOC.md"), "이 프로젝트의 문서는 실려야 한다");
  assert.ok(prompt.includes("OTHER_SECRET.env"), "이 프로젝트의 doNotTouch는 실려야 한다");
  // acos 전용 규칙이 다른 프로젝트의 지시문에 새어 들어가면 안 된다 —
  // 코드에 하드코딩됐다면 항상 섞여 나왔을 것이다.
  assert.ok(!prompt.includes("benchmark/constants.ts"), "다른 프로젝트의 규칙이 섞이면 안 된다");
});

await test("실행할 작업을 지정할 수 있다 — 지정하지 않으면 전처럼 대기열의 첫 작업", async () => {
  await exec.waitForRun(exec.listRunning()[0]?.runId ?? "");
  io.createTask({ taskId: "SPEC-Z", title: "맨 뒤", request: "확인" });

  // 대기열의 맨 앞이 무엇인지 먼저 확인한다 — 앞선 검사들이 남긴 것이 있다.
  const head = exec.startNextTask({ cwd: sandbox, dryRun: true });
  assert.notEqual(head.taskId, "SPEC-Z", "SPEC-Z는 맨 뒤여야 검사가 성립한다");

  const picked = exec.startNextTask({ cwd: sandbox, dryRun: true, taskId: "SPEC-Z" });
  assert.equal(picked.taskId, "SPEC-Z", "지정한 작업을 집어야 한다");

  const again = exec.startNextTask({ cwd: sandbox, dryRun: true });
  assert.equal(again.taskId, head.taskId, "지정하지 않으면 기존 동작 그대로여야 한다");
});

await test("대기 중이 아닌 작업을 지정하면 이유를 알려 준다", () => {
  const gone = exec.startNextTask({ cwd: sandbox, dryRun: true, taskId: "없는작업" });
  assert.equal(gone.accepted, false);
  assert.ok(gone.reason.includes("없는 작업"), gone.reason);

  // TESTING은 "버려진 실행"이 아니므로 자동 복구 대상이 아니다 —
  // 지정해서 실행하려 하면 거절하고 이유를 알려 줘야 한다.
  io.writeResult({ taskId: "SPEC-Z", state: "IN_PROGRESS" });
  io.writeResult({ taskId: "SPEC-Z", state: "TESTING" });
  const stuck = exec.startNextTask({ cwd: sandbox, dryRun: true, taskId: "SPEC-Z" });
  assert.equal(stuck.accepted, false);
  assert.ok(stuck.reason.includes("TESTING"), stuck.reason);
  assert.ok(stuck.reason.includes("resetTask"), "어떻게 푸는지 알려 줘야 한다");
});

await test("기존 실패를 따로 적을 자리를 알려 준다 — 안 그러면 게이트가 막는다", () => {
  const prompt = exec.buildPrompt({ taskId: "T9-9", title: "제목", request: "요청" });
  assert.ok(prompt.includes("preExisting"), "기존 문제를 적을 자리를 알려야 한다");
  assert.ok(prompt.includes("이번 변경분이 통과했는가"), "ok 의 뜻을 못 박아야 한다");
});

await test("통과 여부를 참/거짓으로 적으라고 시킨다 — 문장을 읽어 짐작하지 않도록", () => {
  const prompt = exec.buildPrompt({ taskId: "T9-9", title: "제목", request: "요청" });
  assert.ok(prompt.includes('"ok"'), "결과 형식에 ok 가 있어야 한다");
  assert.ok(prompt.includes("돌리지 않았다면"), "안 돌린 검사를 통과로 적지 못하게 해야 한다");
});

await test("완료된 작업은 되돌리지 않는다 — 종료 상태는 종료 상태다", () => {
  io.createTask({ taskId: "SPEC-4", title: "완료 보호", request: "확인" });
  io.writeResult({ taskId: "SPEC-4", state: "IN_PROGRESS" });
  io.writeResult({ taskId: "SPEC-4", state: "TESTING" });
  io.writeResult({
    taskId: "SPEC-4",
    state: "READY_FOR_REVIEW",
    testResults: { build: "성공", typecheck: "성공", lint: "오류 0", tests: "전부 통과" },
    browserUrl: "http://localhost:3100",
    userChecks: ["확인"],
    changedFiles: [],
  });
  io.writeResult({ taskId: "SPEC-4", state: "COMPLETED" });
  assert.throws(() => io.resetToRequested("SPEC-4"), /되돌릴 수 없습니다/);
});

/* ---- 깨진 작업 파일이 있어도 서버 전체가 죽지 않는다 (실측, 2026-08-09) ---- */

await test("0바이트로 잘린 작업 파일이 있어도 listTasks가 죽지 않는다", () => {
  // 디스크가 가득 찬 상태에서 쓰다 만 파일을 흉내낸다 — 실제로
  // bridge/tasks/T1-30.json이 이 모양으로 발견됐다. recoverAbandonedRuns가
  // 서버 시작 때마다 모든 프로젝트의 listTasks를 부르므로, 이런 파일 하나가
  // Bridge 서버 자체를 못 뜨게 만들었다.
  io.createTask({ taskId: "SPEC-GOOD", title: "정상 작업", request: "확인" });
  writeFileSync(join(io.paths.TASKS_DIR, "SPEC-BROKEN.json"), "");

  const tasks = io.listTasks();
  assert.ok(
    tasks.some((t) => t.taskId === "SPEC-GOOD"),
    "깨지지 않은 작업은 그대로 나와야 한다",
  );
  assert.ok(
    !tasks.some((t) => t.taskId === "SPEC-BROKEN"),
    "깨진 파일은 조용히 건너뛰어야 한다 — 지어내지 않는다",
  );
});

await test("recoverAbandonedRuns도 깨진 파일 옆에서 죽지 않는다 — 서버 시작 경로다", () => {
  // 이 함수가 서버 listen() 콜백에서 매번 불린다. 여기서 죽으면 서버가
  // 아예 뜨지 못한다 — 가장 심각한 실패다.
  assert.doesNotThrow(() => exec.recoverAbandonedRuns());
});

console.log(`\n검사 ${passed + failed}건 · 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

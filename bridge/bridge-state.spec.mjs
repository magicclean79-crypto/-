/**
 * CTO Bridge 상태 계층 검사.
 *
 * **초록만 나오는 게이트는 게이트가 아니다.** 여기서 확인하는 것은
 * "정상 경로가 통과한다"가 아니라 **"건너뛰기가 실제로 막힌다"** 이다.
 *
 * 실행: node bridge/bridge-state.spec.mjs
 * (jest는 apps/packages 안만 보므로 독립 실행 파일로 둔다)
 */

import assert from "node:assert/strict";
import {
  abandonedRun,
  blockedGate,
  canTransition,
  checkFailed,
  readyForReview,
  summarize,
  TASK_STATES,
} from "./bridge-state.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  실패 ${name}`);
    console.log(`       ${error.message}`);
  }
}

console.log("CTO Bridge — 상태 계층 검사\n");

test("상태는 6단계다 (진행 5단계 + BLOCKED)", () => {
  assert.deepEqual(TASK_STATES, [
    "REQUESTED",
    "IN_PROGRESS",
    "TESTING",
    "READY_FOR_REVIEW",
    "COMPLETED",
    "BLOCKED",
  ]);
});

test("정상 경로는 통과한다", () => {
  assert.equal(canTransition("REQUESTED", "IN_PROGRESS").ok, true);
  assert.equal(canTransition("IN_PROGRESS", "TESTING").ok, true);
  assert.equal(canTransition("TESTING", "READY_FOR_REVIEW").ok, true);
  assert.equal(canTransition("READY_FOR_REVIEW", "COMPLETED").ok, true);
});

test("건너뛰기를 막는다 — 코드만 쓰고 사람에게 보여 줄 수 없다", () => {
  assert.equal(canTransition("REQUESTED", "READY_FOR_REVIEW").ok, false);
  assert.equal(canTransition("IN_PROGRESS", "READY_FOR_REVIEW").ok, false);
  assert.equal(canTransition("REQUESTED", "COMPLETED").ok, false);
  assert.equal(canTransition("TESTING", "COMPLETED").ok, false);
});

test("검증 실패 시 구현으로 되돌아갈 수 있다 — 자동 반복의 통로", () => {
  assert.equal(canTransition("TESTING", "IN_PROGRESS").ok, true);
  assert.equal(canTransition("READY_FOR_REVIEW", "IN_PROGRESS").ok, true);
});

test("중단된 실행은 대기열로 되돌릴 수 있다 — 복구 통로", () => {
  assert.equal(canTransition("IN_PROGRESS", "REQUESTED").ok, true);
});

test("복구 통로가 생겨도 앞으로 건너뛰는 것은 여전히 막힌다", () => {
  assert.equal(canTransition("REQUESTED", "TESTING").ok, false);
  assert.equal(canTransition("REQUESTED", "READY_FOR_REVIEW").ok, false);
  assert.equal(canTransition("IN_PROGRESS", "READY_FOR_REVIEW").ok, false);
  assert.equal(canTransition("IN_PROGRESS", "COMPLETED").ok, false);
  // 뒤로 가는 것도 아무렇게나 되지는 않는다
  assert.equal(canTransition("TESTING", "REQUESTED").ok, false);
  assert.equal(canTransition("COMPLETED", "REQUESTED").ok, false);
});

test("완료는 종료 상태다", () => {
  assert.equal(canTransition("COMPLETED", "IN_PROGRESS").ok, false);
});

test("정말 막히면 BLOCKED로 옆으로 빠질 수 있다 — 진행 단계를 건너뛰지 않는다", () => {
  assert.equal(canTransition("IN_PROGRESS", "BLOCKED").ok, true);
  assert.equal(canTransition("TESTING", "BLOCKED").ok, true);
});

test("BLOCKED는 사람 결정 후에만 다시 돈다", () => {
  assert.equal(canTransition("BLOCKED", "IN_PROGRESS").ok, true);
  assert.equal(canTransition("BLOCKED", "REQUESTED").ok, true);
  // BLOCKED에서 검증을 건너뛰고 곧장 사람 확인 단계로 갈 수는 없다
  assert.equal(canTransition("BLOCKED", "READY_FOR_REVIEW").ok, false);
  assert.equal(canTransition("BLOCKED", "COMPLETED").ok, false);
});

test("BLOCKED로 가려면 무엇을 정해야 하는지 적어야 한다 — 막히는 것이 쉬운 선택지가 되면 안 된다", () => {
  assert.equal(blockedGate({}).ok, false);
  assert.equal(blockedGate({ decisionNeeded: [] }).ok, false);
  assert.equal(
    blockedGate({ decisionNeeded: [{ question: "새 프로젝트 저장소 경로를 어디로 할까요?" }] }).ok,
    false,
    "이유(why) 없이는 통과하면 안 된다",
  );
  assert.equal(
    blockedGate({
      decisionNeeded: [{ question: "새 프로젝트 저장소 경로를 어디로 할까요?", why: "범위 밖 결정" }],
    }).ok,
    true,
  );
});

test("BLOCKED도 사람이 확인해야 하는 자리다", () => {
  const row = summarize(
    { taskId: "T9-9", title: "제목" },
    { state: "BLOCKED", decisionNeeded: [{ question: "q", why: "w" }] },
  );
  assert.equal(row.needsHumanDecision, true);
  assert.deepEqual(row.decisionNeeded, [{ question: "q", why: "w" }]);
});

test("모르는 상태는 거부한다", () => {
  assert.equal(canTransition("DONE", "COMPLETED").ok, false);
  assert.equal(canTransition("REQUESTED", "SHIPPED").ok, false);
});

const fullResult = {
  testResults: { build: "6/6 성공", typecheck: "오류 0", lint: "오류 0", tests: "130개 통과" },
  browserUrl: "http://localhost:3100/image-studio",
  userChecks: ["제품이 원본과 같은지"],
  changedFiles: ["bridge/bridge-state.mjs"],
};

test("검증 기록이 다 있으면 사람에게 보여 줄 수 있다", () => {
  assert.equal(readyForReview(fullResult).ok, true);
});

test("게이트 기록이 빠지면 막는다", () => {
  for (const key of ["build", "typecheck", "lint", "tests"]) {
    const broken = { ...fullResult, testResults: { ...fullResult.testResults } };
    delete broken.testResults[key];
    assert.equal(readyForReview(broken).ok, false, `${key} 없이 통과하면 안 된다`);
  }
});

test("브라우저 주소가 없으면 막는다 — 사람이 볼 곳이 없다", () => {
  assert.equal(readyForReview({ ...fullResult, browserUrl: null }).ok, false);
});

test("확인할 항목이 없으면 막는다 — 무엇을 보라는 것인지 없다", () => {
  assert.equal(readyForReview({ ...fullResult, userChecks: [] }).ok, false);
});

test("'실패 0' 같은 표현을 실패로 읽지 않는다 (실측 결함, 2026-08-09)", () => {
  const ok = {
    ...fullResult,
    testResults: {
      ...fullResult.testResults,
      imageGeneration: "12장 생성 · 실패 0",
      browserVerification: "14개 항목 전부 통과",
      lint: "오류 0",
    },
  };
  const gate = readyForReview(ok);
  assert.equal(gate.ok, true, `막히면 안 된다: ${gate.reason}`);
});

test("영문 'failures: 0' 도 실패로 읽지 않는다", () => {
  const ok = { ...fullResult, testResults: { ...fullResult.testResults, tests: "130 passed, 0 failures" } };
  assert.equal(readyForReview(ok).ok, true);
});

test("'13건 통과, 0건 실패'를 실패로 읽지 않는다 (실측 결함, 2026-08-09)", () => {
  const ok = {
    ...fullResult,
    testResults: { ...fullResult.testResults, tests: "PASS — 13건 통과, 0건 실패" },
  };
  const gate = readyForReview(ok);
  assert.equal(gate.ok, true, `막히면 안 된다: ${gate.reason}`);
});

test("'실행 안 함'은 실패가 아니다 — 다만 기록은 있어야 한다", () => {
  const ok = {
    ...fullResult,
    testResults: { ...fullResult.testResults, build: "실행 안 함(요청 범위 밖)" },
  };
  assert.equal(readyForReview(ok).ok, true);
});

/* ---- 통과 여부를 글로 짐작하지 않고 명시값으로 받는다 ---- */

const okResult = {
  ...fullResult,
  testResults: {
    build: { ok: true, detail: "12/12 성공" },
    typecheck: { ok: true, detail: "10/10, 오류 0" },
    lint: { ok: true, detail: "npx eslint . — 0건 (기존 4건 전부 해소, 새 오류 없음)" },
    tests: { ok: true, detail: "1879/1879 통과 · api 8건 실패는 preExisting 참고" },
  },
};

test("ok:true 면 문장에 '실패'·'오류'가 들어 있어도 통과시킨다 (실측 결함, 2026-08-09)", () => {
  const gate = readyForReview(okResult);
  assert.equal(gate.ok, true, `막히면 안 된다: ${gate.reason}`);
});

test("ok:false 면 문장이 아무리 좋아 보여도 막는다", () => {
  const bad = {
    ...okResult,
    testResults: { ...okResult.testResults, tests: { ok: false, detail: "전부 통과했습니다" } },
  };
  const gate = readyForReview(bad);
  assert.equal(gate.ok, false);
  assert.ok(gate.failed.includes("tests"));
});

test("ok가 없는 빈 객체는 기록으로 인정하지 않는다", () => {
  const bad = { ...okResult, testResults: { ...okResult.testResults, lint: {} } };
  assert.equal(readyForReview(bad).ok, false);
});

test("'오류 없음'·'no errors'를 실패로 읽지 않는다 (문자열 형태)", () => {
  assert.equal(checkFailed("eslint 0건, 새 오류 없음"), false);
  assert.equal(checkFailed("build passed, no errors"), false);
  assert.equal(checkFailed("테스트 실패 없음"), false);
  assert.equal(checkFailed("12장 생성 · 실패 0"), false);
  // 진짜 실패는 여전히 잡는다
  assert.equal(checkFailed("3개 실패"), true);
  assert.equal(checkFailed("2 errors"), true);
});

test("요구 검사 목록은 프로젝트가 정한다 — 빌드 없는 저장소도 통과할 수 있어야 한다", () => {
  const onlyTests = {
    changedFiles: ["src/shipping.js"],
    browserUrl: "http://localhost:4201",
    userChecks: ["확인"],
    testResults: { tests: { ok: true, detail: "6 pass, 0 fail" } },
  };
  // 기본 네 가지를 요구하면 막힌다 — 이 저장소에는 빌드가 없다.
  assert.equal(readyForReview(onlyTests).ok, false);
  // 프로젝트가 tests 만 요구하면 통과한다.
  assert.equal(readyForReview(onlyTests, ["tests"]).ok, true);
});

test("요구 목록이 비어 있으면 기본 네 가지로 돌아간다 — 게이트를 없앨 수는 없다", () => {
  const empty = { changedFiles: [], browserUrl: "x", userChecks: ["y"], testResults: {} };
  assert.equal(readyForReview(empty, []).ok, false);
  assert.deepEqual(readyForReview(empty, []).missing, readyForReview(empty).missing);
});

test("요구한 검사가 실패로 적혀 있으면 여전히 막는다", () => {
  const failing = {
    changedFiles: [],
    browserUrl: "x",
    userChecks: ["y"],
    testResults: { tests: { ok: false, detail: "2 fail" } },
  };
  assert.equal(readyForReview(failing, ["tests"]).ok, false);
});

test("검사가 실패했다고 적혀 있으면 막는다", () => {
  const broken = {
    ...fullResult,
    testResults: { ...fullResult.testResults, tests: "3개 실패" },
  };
  const gate = readyForReview(broken);
  assert.equal(gate.ok, false);
  assert.ok(gate.failed.includes("tests"));
});

/* ---- 비동기 실행: 버려진 실행 판정 (524 대책) ---- */

const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const running = {
  state: "IN_PROGRESS",
  runId: "run-1",
  startedAt: "2026-08-09T11:00:00.000Z",
  heartbeatAt: "2026-08-09T11:59:50.000Z",
};

test("살아 있는 실행은 오래 걸려도 버려진 것이 아니다 — 이것이 524 대책의 핵심", () => {
  // 한 시간째 돌고 있어도, 이 프로세스가 돌리고 있으면 정상이다.
  assert.equal(abandonedRun(running, NOW, 5 * 60 * 1000, ["run-1"]).abandoned, false);
});

test("심장박동이 최근이면 살아 있는 것으로 본다", () => {
  assert.equal(abandonedRun(running, NOW, 5 * 60 * 1000, []).abandoned, false);
});

test("오래 조용하면 버려진 실행이다 — 안 그러면 영원히 IN_PROGRESS에 갇힌다", () => {
  const stale = { ...running, heartbeatAt: "2026-08-09T11:30:00.000Z" };
  const verdict = abandonedRun(stale, NOW, 5 * 60 * 1000, []);
  assert.equal(verdict.abandoned, true);
  assert.ok(verdict.reason);
});

test("실행 식별자가 없는 IN_PROGRESS는 버려진 것이다 (비동기 이전 기록)", () => {
  assert.equal(abandonedRun({ state: "IN_PROGRESS" }, NOW, 5 * 60 * 1000, []).abandoned, true);
});

test("IN_PROGRESS가 아니면 복구 대상이 아니다", () => {
  for (const state of ["REQUESTED", "TESTING", "READY_FOR_REVIEW", "COMPLETED"]) {
    assert.equal(abandonedRun({ ...running, state }, NOW, 0, []).abandoned, false, state);
  }
  assert.equal(abandonedRun(null, NOW, 0, []).abandoned, false);
});

test("서버 재시작 시(limit -1) 살아 있지 않은 실행은 전부 복구 대상이다", () => {
  assert.equal(abandonedRun(running, NOW, -1, []).abandoned, true);
  // 다만 이 프로세스가 실제로 돌리고 있으면 건드리지 않는다
  assert.equal(abandonedRun(running, NOW, -1, ["run-1"]).abandoned, false);
});

test("요약에 진행 상황이 실린다 — ChatGPT가 '아직 도는 중'을 알 수 있어야 한다", () => {
  const row = summarize({ taskId: "T1-22", title: "제품 자동 조사" }, running);
  assert.equal(row.state, "IN_PROGRESS");
  assert.equal(row.runId, "run-1");
  assert.equal(row.startedAt, running.startedAt);
  assert.equal(row.heartbeatAt, running.heartbeatAt);
  assert.equal(row.finishedAt, null);
});

console.log(`\n검사 ${passed + failed}건 · 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

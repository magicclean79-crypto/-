/**
 * CTO Bridge — 무인 실행 권한 검사 (T1-29).
 *
 * **여기서 확인하는 것은 "호출이 된다"가 아니다.** 확인하는 것은 **"승인
 * 창을 만들 수 있는 자리가 실제로 막혀 있다"** 다.
 *
 * 이 검사는 실제 `claude.exe`를 부르지 않는다 — 비용이 든다. 대신
 * `bridge-executor.mjs`가 내보내는 순수 함수(인자 조립·권한 거부 판정)를
 * 정적으로 검사한다. 실제 CLI 호출로 두 가지를 **실측 확인**했다
 * (2026-08-09, 스크래치 디렉터리에서 직접 실행, 증거는 T1-29 결과에 기록):
 *
 *   1. 지금 이 파일이 검사하는 플래그 조합
 *      (`--dangerously-skip-permissions` + `--permission-mode
 *      bypassPermissions` + stdin 닫기)을 그대로 주면, 승인이 필요한
 *      명령(네트워크 호출 포함)도 **멈추지 않고 즉시 실행**되며
 *      `permission_denials`가 항상 빈 배열이다.
 *   2. 이 플래그들을 **빼면** 같은 명령이 표준입력을 기다리며 멈추는 대신
 *      **자동 거부**되고, 그 사실이 `permission_denials`에 남는다 — 무인
 *      실행이 조용히 "사람에게 물어보는" 대화를 만들어내는 대신, CLI
 *      스스로 거부한 것이다.
 *
 * **T1-29 재검증(2026-08-09)에서 추가로 확인한 사실**: 설치된 CLI
 * (`claude.exe --version` 2.1.226)의 공식 `--help`에는 "워크스페이스 신뢰
 * 대화상자는 비대화형 모드(`-p` 또는 stdout이 TTY가 아닐 때)에서
 * 건너뛴다"고 명시돼 있다. 이건 Bash 등 **도구 승인**과는 별개의
 * 대화상자이고, `~/.claude.json`을 실제로 읽어 보면 이 저장소 경로의
 * `hasTrustDialogAccepted`가 `false`로 남아 있다 — 즉 신뢰 승인 자체는
 * 아직 안 돼 있지만, `-p` + 비TTY 출력 조합이 그 대화상자가 열릴 조건
 * 자체를 없앤다. 그래서 `-p`와 비TTY(stdio pipe)도 이 파일에서 함께
 * 검사한다 — 둘 중 하나가 빠지면 권한 승인과 무관하게 신뢰 대화상자가
 * 다시 열릴 수 있다.
 *
 * 실행: node bridge/bridge-permission.spec.mjs
 */

import assert from "node:assert/strict";
import {
  buildClaudeArgs,
  claudeSpawnOptions,
  extractPermissionDenials,
  buildPermissionDecision,
  parseStreamJson,
} from "./bridge-executor.mjs";

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

console.log("CTO Bridge — 무인 실행 권한 검사\n");

test("승인 창을 막는 두 플래그가 항상 함께 들어간다", () => {
  const args = buildClaudeArgs("아무 프롬프트");
  assert.ok(args.includes("--dangerously-skip-permissions"), "--dangerously-skip-permissions 가 빠졌습니다");
  const modeAt = args.indexOf("--permission-mode");
  assert.notEqual(modeAt, -1, "--permission-mode 가 빠졌습니다");
  assert.equal(args[modeAt + 1], "bypassPermissions", "bypassPermissions 값이 아닙니다");
});

test("stream-json 을 쓴다 — 출력이 없으면 멈춘 것과 도는 것을 구분할 수 없다", () => {
  const args = buildClaudeArgs("아무 프롬프트");
  const at = args.indexOf("--output-format");
  assert.notEqual(at, -1);
  assert.equal(args[at + 1], "stream-json");
});

test("비용 상한이 항상 들어간다", () => {
  const args = buildClaudeArgs("아무 프롬프트");
  assert.ok(args.includes("--max-budget-usd"));
});

test("stdin 을 완전히 닫는다 — 무인 실행에서 입력을 기다리는 일은 없어야 한다", () => {
  const opts = claudeSpawnOptions("C:\\어딘가");
  assert.equal(opts.stdio[0], "ignore", "stdin이 'ignore'가 아니면 입력을 기다리다 조용히 멈출 수 있습니다");
});

test("-p(비대화형) 플래그가 맨 앞에 있다 — 워크스페이스 신뢰 대화상자를 건너뛰는 공식 조건", () => {
  const args = buildClaudeArgs("아무 프롬프트");
  assert.equal(args[0], "-p", "-p가 없거나 맨 앞이 아니면 신뢰 대화상자가 다시 열릴 수 있습니다");
});

test("stdout·stderr가 pipe다 — TTY가 아니어야 -p와 함께 신뢰 대화상자가 열리지 않는다", () => {
  const opts = claudeSpawnOptions("C:\\어딘가");
  assert.equal(opts.stdio[1], "pipe");
  assert.equal(opts.stdio[2], "pipe");
});

test("권한 거부가 없으면 빈 배열이다 — '완전히 무인이었다'는 뜻이다", () => {
  assert.deepEqual(extractPermissionDenials({ response: { permission_denials: [] } }), []);
  assert.deepEqual(extractPermissionDenials({ response: {} }), []);
  assert.deepEqual(extractPermissionDenials({}), []);
  assert.deepEqual(extractPermissionDenials(null), []);
});

test("권한 거부가 있으면 그대로 뽑아 온다 — 숨기지 않는다", () => {
  const denials = [{ tool_name: "Bash", tool_input: { command: "curl https://example.com" } }];
  assert.deepEqual(extractPermissionDenials({ response: { permission_denials: denials } }), denials);
});

test("parseStreamJson 은 permission_denials 를 지우지 않고 그대로 전달한다", () => {
  const denials = [{ tool_name: "Bash", tool_input: { command: "rm -rf /" } }];
  const line = JSON.stringify({ type: "result", result: "DONE", permission_denials: denials });
  const parsed = parseStreamJson(`${line}\n`);
  assert.deepEqual(parsed.permission_denials, denials);
});

test("권한 거부가 없으면 사람에게 물을 결정 사항도 없다", () => {
  assert.deepEqual(buildPermissionDecision([]), []);
  assert.deepEqual(buildPermissionDecision(undefined), []);
});

test("권한 거부가 있으면 사람이 정할 결정으로 바뀐다 — 질문·이유가 함께 있어야 BLOCKED 게이트를 통과한다", () => {
  const denials = [{ tool_name: "Bash", tool_input: { command: "curl https://example.com" } }];
  const decisions = buildPermissionDecision(denials);
  assert.equal(decisions.length, 1);
  assert.ok(decisions[0].question.includes("curl"), "어떤 명령이 거부됐는지 질문에 남아야 합니다");
  assert.ok(decisions[0].why, "스스로 정할 수 없는 이유가 있어야 합니다(BLOCKED 게이트 요건)");
  assert.ok(Array.isArray(decisions[0].options) && decisions[0].options.length > 0);
});

console.log(`\n검사 ${passed + failed}건 · 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

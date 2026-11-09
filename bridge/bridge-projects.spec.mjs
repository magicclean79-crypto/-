/**
 * CTO Bridge — 프로젝트 계층 검사 (Project Registry).
 *
 * **여기서 확인하는 것은 "등록이 된다"가 아니다.** 확인하는 것은
 * **"프로젝트가 서로 새지 않는다"** 다 — 다른 프로젝트의 작업 지시가
 * 엉뚱한 저장소를 대상으로 하거나, 프로젝트 ID로 저장소 바깥을 건드릴
 * 수 있으면 이 계층은 없는 것과 같다.
 *
 * 진짜 저장소(`bridge/projects/`)를 건드리지 않도록 **임시 폴더**를
 * `PROJECTS_DIR`처럼 쓴다 — bridge-projects.mjs 자체를 복사해서 그 옆에
 * `projects/`가 생기게 한다.
 *
 * 실행: node bridge/bridge-projects.spec.mjs
 */

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

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

console.log("CTO Bridge — 프로젝트 계층 검사\n");

// bridge-projects.mjs는 **자기 파일 위치 기준**으로 projects/ 를 찾는다.
// 진짜 bridge/projects/ 를 건드리지 않으려고, 파일을 임시 폴더에 복사해
// 거기서 등록·조회를 시킨다 — 저장소는 흔적 없이 그대로 남는다.
const sandboxRoot = mkdtempSync(join(tmpdir(), "bridge-projects-spec-"));
const sandboxBridge = join(sandboxRoot, "bridge");
mkdirSync(sandboxBridge, { recursive: true });
cpSync(join(HERE, "bridge-projects.mjs"), join(sandboxBridge, "bridge-projects.mjs"));

// 등록할 저장소도 실제로 존재해야 한다(registerProject가 막는다) — 가짜
// 프로젝트 두 개를 준비한다.
const repoA = join(sandboxRoot, "repo-a");
const repoB = join(sandboxRoot, "repo-b");
mkdirSync(repoA, { recursive: true });
mkdirSync(repoB, { recursive: true });

const mod = await import(pathToFileURL(join(sandboxBridge, "bridge-projects.mjs")).href);
const {
  DEFAULT_PROJECT_ID,
  validProjectId,
  registerProject,
  readProject,
  listProjects,
  requireProject,
  projectPaths,
} = mod;

test("프로젝트 ID는 소문자·숫자·하이픈만 허용한다", () => {
  assert.equal(validProjectId("demo-widget"), true);
  assert.equal(validProjectId("acos2"), true);
  assert.equal(validProjectId(""), false);
  assert.equal(validProjectId("Demo"), false, "대문자는 안 된다");
  assert.equal(validProjectId("demo_widget"), false, "밑줄은 안 된다");
  assert.equal(validProjectId(123), false, "문자열이 아니면 안 된다");
});

test("'..'이 들어간 ID는 거부한다 — 저장소 바깥을 건드릴 수 있는 유일한 경로다", () => {
  assert.equal(validProjectId(".."), false);
  assert.equal(validProjectId("../../etc"), false);
  assert.equal(validProjectId("a/../b"), false);
  assert.equal(validProjectId("a/b"), false, "경로 구분자 자체가 안 된다");
});

test("너무 긴 ID는 거부한다", () => {
  assert.equal(validProjectId("a".repeat(40)), true, "40자는 된다");
  assert.equal(validProjectId("a".repeat(41)), false, "41자는 안 된다");
});

test("기본 프로젝트(acos)는 등록 파일이 없어도 항상 존재한다", () => {
  const project = readProject(DEFAULT_PROJECT_ID);
  assert.ok(project, "파일 없이도 값이 나와야 한다");
  assert.equal(project.projectId, DEFAULT_PROJECT_ID);
  assert.ok(Array.isArray(project.docs) && project.docs.length > 0, "7개 공식 문서를 알아야 한다");
  assert.ok(project.doNotTouch.some((d) => d.includes("benchmark/constants.ts")));
});

test("등록되지 않은 프로젝트는 null이다 — 추측해서 만들어 주지 않는다", () => {
  assert.equal(readProject("no-such-project"), null);
});

test("requireProject는 없는 프로젝트를 던진다", () => {
  assert.throws(() => requireProject("no-such-project"), /등록되지 않은 프로젝트/);
});

let registered;
test("새 프로젝트를 등록할 수 있다", () => {
  registered = registerProject({
    projectId: "demo-widget",
    name: "데모 위젯",
    repoPath: repoA,
    docs: ["README.md"],
    doNotTouch: ["NOTES.md (증거 파일)"],
    verifyCommands: ["npm test"],
    browserUrl: null,
    scope: "index.mjs의 문자열 유틸리티만 다룬다.",
  });
  assert.equal(registered.projectId, "demo-widget");
  assert.equal(registered.repoPath, repoA);
});

test("등록한 프로젝트를 다시 읽으면 그대로 나온다", () => {
  const project = readProject("demo-widget");
  assert.equal(project.name, "데모 위젯");
  assert.deepEqual(project.docs, ["README.md"]);
  assert.deepEqual(project.verifyCommands, ["npm test"]);
});

test("같은 ID로 두 번 등록하면 거부한다 — 조용히 덮어쓰지 않는다", () => {
  assert.throws(
    () => registerProject({ projectId: "demo-widget", name: "다시", repoPath: repoA }),
    /이미 등록된 프로젝트/,
  );
});

test("잘못된 ID로는 등록할 수 없다", () => {
  assert.throws(
    () => registerProject({ projectId: "Bad_Id", name: "x", repoPath: repoA }),
    /projectId/,
  );
});

test("이름이나 저장소 경로가 없으면 등록할 수 없다", () => {
  assert.throws(() => registerProject({ projectId: "no-name", repoPath: repoA }), /name/);
  assert.throws(() => registerProject({ projectId: "no-repo", name: "x" }), /repoPath/);
});

test("없는 저장소 경로는 등록할 수 없다 — 실행할 때가 아니라 지금 막는다", () => {
  assert.throws(
    () => registerProject({ projectId: "ghost", name: "유령", repoPath: join(sandboxRoot, "no-such-dir") }),
    /저장소 경로가 없습니다/,
  );
});

test("listProjects는 기본 프로젝트를 항상 포함한다", () => {
  const all = listProjects();
  assert.ok(all.some((p) => p.projectId === DEFAULT_PROJECT_ID));
  assert.ok(all.some((p) => p.projectId === "demo-widget"));
});

test("등록한 프로젝트가 늘어도 서로 섞이지 않는다", () => {
  registerProject({ projectId: "demo-widget-2", name: "두 번째 데모", repoPath: repoB });
  const all = listProjects();
  const widget1 = all.find((p) => p.projectId === "demo-widget");
  const widget2 = all.find((p) => p.projectId === "demo-widget-2");
  assert.equal(widget1.repoPath, repoA);
  assert.equal(widget2.repoPath, repoB);
  assert.notEqual(widget1.repoPath, widget2.repoPath);
});

test("프로젝트마다 작업·결과 폴더가 분리된다 — 같은 통에 섞이지 않는다", () => {
  const acos = projectPaths(DEFAULT_PROJECT_ID);
  const demo = projectPaths("demo-widget");
  assert.notEqual(acos.TASKS_DIR, demo.TASKS_DIR);
  assert.notEqual(acos.RESULTS_DIR, demo.RESULTS_DIR);
  assert.notEqual(acos.STATUS_FILE, demo.STATUS_FILE);
  // 기본 프로젝트는 옛 자리(bridge/tasks·bridge/results)를 그대로 쓴다 —
  // "동작하는 것을 이유 없이 옮기지 않는다"는 설계 결정이다.
  assert.equal(acos.root, sandboxBridge);
  assert.ok(demo.TASKS_DIR.includes("demo-widget"));
});

console.log(`\n검사 ${passed + failed}건 · 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * T1-203 — 단일 공식 검증 명령. `pnpm run verify:all`
 *
 * ## 왜 이 스크립트가 필요한가 (근본 원인, T1-198·T1-199·T1-201·T1-202)
 *
 * 이 저장소는 Bridge(`bridge/bridge-executor.mjs`)가 `claude -p "<지시>"`로
 * **1회성 헤드리스 호출**을 한다 — 대화가 이어지는 세션이 아니라, 그 한 번의
 * 호출 안에서 모델이 도구 호출을 멈추면(최종 답변을 내면) 프로세스가
 * 끝난다. 이전 여러 세션(T1-198·T1-199·T1-201·T1-202)이 빌드/기동을
 * background로 띄워 두고 "완료 알림을 받으면 이어서 하겠다"는 최종 답변을
 * 남긴 채 멈췄다 — **이 실행 모델에는 나중에 알림을 받아 이어갈 다음 턴이
 * 없다.** background 프로세스는 그대로 고아가 되고, Bridge 결과 파일에는
 * build/typecheck/lint/test 기록이 하나도 남지 않은 채 `TESTING`에 멈췄다
 * (`bridge/results/T1-198.json`·`T1-199.json`·`T1-201.json`·`T1-202.json`
 * 실측).
 *
 * ## 이 스크립트가 하는 일
 *
 * 아래 전체 파이프라인을 **한 프로세스 안에서 순서대로, 각 단계마다 정해진
 * timeout으로** 실행한다 — 어떤 단계도 "띄워두고 기다리겠다"고 선언한 채
 * 끝나지 않는다. 각 단계가 끝나는 즉시 `scripts/.verify-all-result.json`에
 * 중간 결과를 쓴다 — 이 스크립트를 background로 띄우더라도, 호출한 쪽은
 * 이 파일을 polling해 진행 상황과 최종 성공/실패를 확인할 수 있다(대화가
 * 다시 이어지길 기다리는 것이 아니라, 같은 턴 안에서 파일을 반복 확인하는
 * 것이므로 이 실행 모델에서도 안전하다).
 *
 *   1. scripts/start-verify-studio.ps1 (3100/4100 idempotent 기동 — 이미
 *      같은 커밋으로 떠 있으면 재빌드 없이 즉시 반환)
 *   2. T1-197·T1-196 URL 두 개 HTTP 200 확인
 *   3. 두 URL을 Chromium(1280/390)으로 열어 console/page error·broken
 *      image 확인 (scripts/t1203-verify-level2-chromium.mjs)
 *   4. pnpm turbo run build
 *   5. pnpm turbo run typecheck
 *   6. npx eslint .
 *   7. pnpm turbo run test
 *
 * 전체에 하드 deadline(기본 45분, VERIFY_ALL_DEADLINE_MS로 조정 가능)을
 * 두고, 넘기면 그 시점까지의 결과와 함께 실패로 확정한다 — 무기한 대기
 * 없음.
 *
 * 종료 코드: 7단계 전부 통과 시 0, 하나라도 실패/timeout이면 1.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const RESULT_FILE = join(HERE, ".verify-all-result.json");

const DEADLINE_MS = Number(process.env.VERIFY_ALL_DEADLINE_MS ?? 45 * 60 * 1000);
const startedAtMs = Date.now();

const BASE_URL = process.env.VERIFY_ALL_BASE_URL ?? "http://localhost:3100";
const LEVEL2_IDS = [
  "cmt6jnzbr0001ul2gim2mwznv", // T1-197
  "cmt5w3vlm0001ulo8qrbc3aqt", // T1-196
];

const state = {
  startedAt: new Date(startedAtMs).toISOString(),
  deadlineMs: DEADLINE_MS,
  finished: false,
  ok: null,
  steps: {},
};

function persist() {
  writeFileSync(RESULT_FILE, JSON.stringify(state, null, 2), "utf8");
}

function remainingMs() {
  return DEADLINE_MS - (Date.now() - startedAtMs);
}

function log(msg) {
  const elapsed = Math.round((Date.now() - startedAtMs) / 1000);
  console.log(`[verify-all +${elapsed}s] ${msg}`);
}

/** 동기 실행. 정해진 timeout을 넘기면 죽이고 실패로 기록한다 — 절대 매달리지 않는다. */
function runStep(name, { cmd, args, cwd, timeoutMs, shell = false }) {
  const budget = Math.min(timeoutMs, Math.max(remainingMs(), 0));
  if (budget <= 0) {
    state.steps[name] = { ok: false, detail: "전체 deadline을 이미 넘겨 시작하지 못했습니다." };
    persist();
    return false;
  }
  log(`${name} 시작 (timeout ${Math.round(budget / 1000)}s)`);
  const result = spawnSync(cmd, args, {
    cwd: cwd ?? REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: budget,
    shell,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const tailOut = (result.stdout ?? "").split("\n").slice(-40).join("\n");
  const tailErr = (result.stderr ?? "").split("\n").slice(-40).join("\n");

  if (result.error && result.error.code === "ETIMEDOUT") {
    state.steps[name] = { ok: false, detail: `${Math.round(budget / 1000)}초 timeout 초과로 강제 종료` };
    log(`${name} 실패 — timeout`);
    persist();
    return false;
  }
  if (result.status !== 0) {
    state.steps[name] = {
      ok: false,
      detail: `exit code ${result.status}. stderr(tail): ${tailErr || "(없음)"}. stdout(tail): ${tailOut || "(없음)"}`,
    };
    log(`${name} 실패 — exit code ${result.status}`);
    persist();
    return false;
  }
  state.steps[name] = { ok: true, detail: `exit code 0. stdout(tail): ${tailOut || "(없음)"}` };
  log(`${name} 통과`);
  persist();
  return true;
}

async function httpCheck(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { url, status: res.status, ok: res.status === 200 };
  } catch (error) {
    return { url, status: null, ok: false, error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  persist();
  const isWindows = process.platform === "win32";

  // 1. Studio 기동 (idempotent, readiness polling은 스크립트 내부에서 처리)
  const studioOk = runStep("studioBoot", {
    cmd: "powershell",
    args: ["-ExecutionPolicy", "Bypass", "-File", "scripts/start-verify-studio.ps1"],
    timeoutMs: 10 * 60 * 1000,
  });

  // 2. URL HTTP 200 확인 (studio가 안 떴으면 바로 실패로 기록하고 계속 진행 —
  //    뒤 단계는 서버 상태와 무관하므로 여기서 전체를 멈추지 않는다)
  if (studioOk) {
    const urls = LEVEL2_IDS.map((id) => `${BASE_URL}/level2-generate/${id}`);
    const httpResults = [];
    for (const url of urls) {
      httpResults.push(await httpCheck(url));
    }
    const httpOk = httpResults.every((r) => r.ok);
    state.steps.httpCheck = { ok: httpOk, detail: JSON.stringify(httpResults) };
    log(`httpCheck ${httpOk ? "통과" : "실패"}`);
    persist();

    // 3. Chromium smoke (console/page error·broken image)
    runStep("chromiumSmoke", {
      cmd: "node",
      args: ["scripts/t1203-verify-level2-chromium.mjs", BASE_URL, ...LEVEL2_IDS],
      timeoutMs: 5 * 60 * 1000,
    });
  } else {
    state.steps.httpCheck = { ok: false, detail: "studioBoot 실패로 건너뜀" };
    state.steps.chromiumSmoke = { ok: false, detail: "studioBoot 실패로 건너뜀" };
    persist();
  }

  // 4-7. build/typecheck/lint/test — pnpm/npx는 Windows에서 .cmd 셸 래퍼라 shell:true 필요
  runStep("build", { cmd: "pnpm", args: ["turbo", "run", "build"], timeoutMs: 10 * 60 * 1000, shell: isWindows });
  runStep("typecheck", { cmd: "pnpm", args: ["turbo", "run", "typecheck"], timeoutMs: 6 * 60 * 1000, shell: isWindows });
  runStep("lint", { cmd: "npx", args: ["eslint", "."], timeoutMs: 6 * 60 * 1000, shell: isWindows });
  runStep("test", { cmd: "pnpm", args: ["turbo", "run", "test"], timeoutMs: 15 * 60 * 1000, shell: isWindows });

  state.finished = true;
  state.finishedAt = new Date().toISOString();
  state.ok = Object.values(state.steps).every((s) => s.ok === true);
  persist();
  log(`전체 종료 — ok=${state.ok}`);
  process.exit(state.ok ? 0 : 1);
}

main().catch((error) => {
  state.finished = true;
  state.ok = false;
  state.fatalError = String(error);
  persist();
  console.error(error);
  process.exit(1);
});

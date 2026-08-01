#!/usr/bin/env node
/**
 * 라이브 검증의 CI 적용 범위. (TASK-4701, Sprint 47 — 지시 4)
 *
 * "CI에서 어디까지 할 수 있는가"는 지금까지 **문서의 문장**이었습니다.
 * 문장은 코드가 바뀌어도 그대로 남습니다 — 검사를 하나 추가한 사람이 그
 * 문장을 고치지 않으면 문서는 틀렸는데 아무도 모릅니다.
 *
 * 판정은 `@acos/core`의 `judgeCiCoverage`가 합니다 — 순수 로직은 한 곳에만
 * 둡니다(`pnpm build` 이후에 돌려야 합니다).
 *
 * 판정:
 *   exit 0 — 목록과 판정을 출력한다 (이 스크립트는 막는 게이트가 아니다)
 *   exit 2 — 판정 불가 (모듈을 읽지 못함) — **통과로 처리하지 않는다**
 */

let judgeCiCoverage;
let humanOnlyChecks;
try {
  ({ judgeCiCoverage, humanOnlyChecks } = await import(
    "../packages/core/dist/index.js"
  ));
} catch (error) {
  console.error(
    `[live-coverage] 판정 로직을 불러오지 못했습니다: ${String(error)}\n` +
      "  pnpm build 이후에 실행해야 합니다 (판정이 @acos/core에 있습니다).",
  );
  process.exit(2);
}

const report = judgeCiCoverage();

console.log("라이브 검사 — CI에서 돌 수 있는가\n");
for (const check of report.checks) {
  const mark = check.verdict === "ci" ? "CI" : "사람";
  console.log(`  [${mark.padEnd(4)}] ${check.title}`);
  if (check.verdict !== "ci") {
    console.log(`         ${check.reason}`);
  }
}

console.log(`\n${report.summary}`);
console.log(`\n${report.caveat}\n`);

console.log("사람만 할 수 있는 것:");
for (const row of humanOnlyChecks(report)) {
  console.log(`  · ${row.title} — ${row.blockedBy}`);
  console.log(`      증명하는 것: ${row.proves}`);
}

process.exit(0);

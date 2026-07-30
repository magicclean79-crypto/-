#!/usr/bin/env node
/**
 * 품질 게이트 자체 검증. (TASK-3501, Sprint 35 — CTO 지시 4)
 *
 * **게이트가 게이트를 검증합니다.** 워크플로에서 게이트 한 줄이 사라져도
 * CI는 여전히 초록으로 끝납니다 — 없어진 검사는 실패하지 않기 때문입니다.
 * 그것이 TASK-3401에서 본 실패의 다른 얼굴입니다: 그때는 게이트가 적혀 있는데
 * 돌지 않았고, 이번에 막으려는 것은 **적혀 있지도 않게 되는 것**입니다.
 *
 * 판정은 `@acos/core`의 `judgeCiWorkflow`가 합니다 — 순수 로직은 한 곳에만
 * 둡니다(결정 2101-③과 같은 이유로 `pnpm build` 이후에 돌려야 합니다).
 *
 * 판정:
 *   exit 0 — 필수 게이트가 순서대로 있다
 *   exit 1 — 빠졌거나 순서가 어긋났다
 *   exit 2 — 판정 불가 (파일·모듈을 읽지 못함) — **통과로 처리하지 않는다**
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = process.env.CI_WORKFLOW_PATH
  ? process.env.CI_WORKFLOW_PATH
  : join(root, ".github", "workflows", "ci.yml");

let judgeCiWorkflow;
try {
  // 빌드 산출물을 직접 읽는다 (check-major-migrations.mjs와 같은 방식)
  ({ judgeCiWorkflow } = await import("../packages/core/dist/index.js"));
} catch (error) {
  console.error(
    `[ci-gates] 판정 로직을 불러오지 못했습니다: ${String(error)}\n` +
      "  pnpm build 이후에 실행해야 합니다 (검증 로직이 @acos/core에 있습니다).",
  );
  process.exit(2);
}

let yaml;
try {
  yaml = readFileSync(workflowPath, "utf8");
} catch (error) {
  console.error(`[ci-gates] 워크플로 파일을 읽지 못했습니다: ${String(error)}`);
  process.exit(2);
}

const judged = judgeCiWorkflow(yaml);

for (const gate of judged.gates) {
  console.log(`  ${gate.present ? "✓" : "✗"} ${gate.title} (${gate.script})`);
}
console.log(
  `  ${judged.browsersInstalled ? "✓" : "✗"} Playwright 브라우저 설치 단계`,
);

if (judged.ok) {
  console.log(`[ci-gates] ${judged.detail}`);
  process.exit(0);
}

console.error(`[ci-gates] ${judged.detail}`);
console.error(
  "  게이트가 워크플로에서 사라지면 CI는 여전히 초록으로 끝납니다 — " +
    "없어진 검사는 실패하지 않기 때문입니다.",
);
process.exit(1);

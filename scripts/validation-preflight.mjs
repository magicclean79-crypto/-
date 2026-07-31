#!/usr/bin/env node
/**
 * 검증 스프린트 사전 점검. (TASK-4301 — CTO 정책 4301-⑤⑥)
 *
 * `/ops/readiness-board` 판정을 **명령 하나로** 확인합니다. `cutover.mjs`가
 * "운영 전환이 끝났는가"에 답한다면, 이것은 **"실 Provider 검증을 시작할 수
 * 있는가"** 에 답합니다.
 *
 * 판정:
 *   exit 0 — 준비 단계가 전부 끝났다 (검증을 시작할 수 있다)
 *   exit 1 — 아직 준비되지 않았다 (막고 있는 것을 출력한다)
 *   exit 2 — 판정 불가 (API 접근·인증 실패) — **통과로 처리하지 않는다**
 *
 * ## 이 스크립트가 하지 않는 일
 *
 * **아무것도 준비해 주지 않습니다.** 남은 것은 자격 증명·나가는 길·검증용
 * 환경·운영 호스트 목록이고 넷 다 사람이 주는 것입니다. 여기서 무언가를
 * 자동으로 채우면 그 초록은 우리가 한 일이 아니라 **우리가 못 하는 일을
 * 가린 것**이 됩니다.
 *
 * 그리고 **강제로 통과시키는 옵션이 없습니다.** 두면 그것이 기본
 * 사용법이 됩니다(정책 4101-⑥과 같은 판단).
 *
 * 사용법:
 *   API_BASE=https://<api-host> \
 *   GATE_EMAIL=admin@acos.local GATE_PASSWORD=... \
 *     node scripts/validation-preflight.mjs
 */
const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const GATE_EMAIL = process.env.GATE_EMAIL ?? "admin@acos.local";
const GATE_PASSWORD = process.env.GATE_PASSWORD ?? "admin1234";

const STATUS_LABEL = {
  ok: "정상",
  warn: "주의",
  fail: "실패",
  // **통과가 아니다** — 확인하지 못한 것이다
  unknown: "확인 못 함",
  blocked: "막힘",
};

function fail(message) {
  console.error(`[preflight] ${message}`);
  process.exit(2);
}

let cookie = "";
try {
  const login = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: GATE_EMAIL, password: GATE_PASSWORD }),
  });
  if (!login.ok) {
    fail(`로그인 실패 (${login.status}) — 판정할 수 없습니다.`);
  }
  cookie = login.headers.get("set-cookie") ?? "";
} catch (error) {
  fail(`API에 닿지 못했습니다: ${String(error)}`);
}

let board;
try {
  const response = await fetch(`${API_BASE}/ops/readiness-board`, {
    headers: { cookie },
  });
  if (!response.ok) {
    fail(`준비 판정을 읽지 못했습니다 (${response.status}).`);
  }
  board = await response.json();
} catch (error) {
  fail(`준비 판정을 읽지 못했습니다: ${String(error)}`);
}

console.log(`[preflight] 배포 단계 ${board.tier}`);
console.log(`[preflight] 준비 ${board.steps.done}/${board.steps.total} 단계`);
for (const tile of board.tiles) {
  const label = STATUS_LABEL[tile.status] ?? tile.status;
  console.log(`  - ${tile.title}: ${label} (${tile.source})`);
  if (tile.next !== null) {
    console.log(`      다음: ${tile.next}`);
  }
}
console.log(`[preflight] ${board.detail}`);

// **확인하지 못한 칸이 있으면 통과가 아닙니다.** 모르는 것을 통과로
// 처리하지 않는다는 규칙이 여기서도 같습니다.
if (board.unknowns.length > 0) {
  console.error(
    `[preflight] 확인하지 못한 칸 ${board.unknowns.length}개: ${board.unknowns.join(" · ")}`,
  );
  process.exit(1);
}

if (board.readiness !== "ready") {
  console.error(
    "[preflight] 아직 검증을 시작할 수 없습니다 — 강제로 여는 방법은 " +
      "없습니다. 막는 조건을 없애야 합니다.",
  );
  process.exit(1);
}

console.log("[preflight] 준비 단계가 전부 끝났습니다.");
process.exit(0);

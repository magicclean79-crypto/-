#!/usr/bin/env node
/**
 * 운영 활성화 게이트. (TASK-3501 · 3601 — CTO 정책 3601-①)
 *
 * `/ops/cutover` 판정을 **명령 하나로** 확인합니다. 배포 게이트
 * (`deployment-gate.mjs`)가 "지금 배포해도 되는가"에 답한다면, 이것은
 * **"운영 전환이 끝났는가"** 에 답합니다.
 *
 * 판정:
 *   exit 0 — 네 항목이 모두 실 연결로 확인됐다
 *   exit 1 — 아직 끝나지 않았다 (남은 항목과 다음 할 일을 출력한다)
 *   exit 2 — 판정 불가 (API 접근·인증 실패) — **통과로 처리하지 않는다**
 *
 * 판정할 수 없을 때 0을 돌려주면 게이트가 있으나 마나 합니다. 확인하지 못한
 * 것은 통과가 아닙니다.
 *
 * 사용법:
 *   API_BASE=https://<api-host> \
 *   GATE_EMAIL=admin@acos.local GATE_PASSWORD=... \
 *     node scripts/cutover.mjs
 *
 * 옵션:
 *   CUTOVER_BRANCH   CI 실행 이력을 이 브랜치로 좁힌다
 *
 * **자격 증명을 넣어 주지 않습니다.** 이 스크립트는 전환을 *수행*하지 않고
 * 전환이 됐는지 *확인*만 합니다 — 통과시키는 우회로를 두지 않는다는 원칙
 * (TASK-3401)의 연장입니다.
 */
const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const GATE_EMAIL = process.env.GATE_EMAIL ?? "admin@acos.local";
const GATE_PASSWORD = process.env.GATE_PASSWORD ?? "admin1234";
const BRANCH = process.env.CUTOVER_BRANCH ?? "";

const LABEL = {
  verified: "실 연결 확인",
  "not-production": "운영의 그것이 아님",
  unverified: "확인 안 됨",
  "not-configured": "미구성",
  invalid: "설정 오류",
  unreachable: "닿지 못함",
};

function fail(message) {
  console.error(`[cutover] ${message}`);
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
    fail(`로그인 실패 (HTTP ${login.status}) — 판정할 수 없습니다.`);
  }
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
} catch (error) {
  fail(`API에 연결할 수 없습니다: ${String(error)}`);
}

const query = BRANCH ? `?branch=${encodeURIComponent(BRANCH)}` : "";
const read = async (path) => {
  const response = await fetch(`${API_BASE}${path}${query}`, {
    headers: cookie ? { cookie } : {},
  });
  if (!response.ok) {
    fail(`판정을 읽지 못했습니다 (${path}, HTTP ${response.status}).`);
  }
  return response.json();
};

let report;
let activation;
try {
  report = await read("/ops/cutover");
  activation = await read("/ops/activation");
} catch (error) {
  fail(`판정을 읽지 못했습니다: ${String(error)}`);
}

console.log(
  `[cutover] ${report.summary.verified}/${report.summary.total} 확인됨` +
    ` (근거 인정 기한 ${report.evidenceWindowDays}일 · 환경 ${report.environment})`,
);

for (const probe of report.egress ?? []) {
  console.log(
    `  ${probe.reachable ? "✓" : "✗"} 도달 ${probe.host} — ${probe.detail}`,
  );
}

for (const row of report.dependencies) {
  const mark = row.status === "verified" ? "✓" : "✗";
  console.log(`  ${mark} ${row.title} — ${LABEL[row.status] ?? row.status}`);
  console.log(`      ${row.detail}`);
  if (row.status !== "verified") {
    console.log(`      다음 할 일: ${row.next}`);
  } else if (row.evidence) {
    console.log(`      근거: ${row.evidence}`);
  }
}

// 운영 활성화 세 조건 (CTO 정책 3601-①) — 하나로 뭉친 초록불은 "무엇이
// 남았는지"를 말하지 못한다
console.log("[cutover] 운영 활성화 조건 (CTO 정책 3601-①)");
for (const condition of activation.conditions) {
  console.log(`  ${condition.met ? "✓" : "✗"} ${condition.title} — ${condition.detail}`);
  if (!condition.met) {
    console.log(`      다음 할 일: ${condition.next}`);
  }
}

if (activation.activated) {
  console.log("[cutover] 운영 활성화 완료 — 세 조건이 모두 충족됐습니다.");
  process.exit(0);
}

// 전환은 운영·Staging에서 한다 (CTO 정책 3501-①). 개발에서 매번 빨간불을
// 내면 사람은 그 빨간불을 무시하게 되고, 정작 운영에서 떴을 때도 무시한다.
// **판정을 감추지는 않는다** — 위에 그대로 찍혔고, 여기서는 이 환경이
// 대상이 아니라는 사실만 말한다.
if (!report.applicable) {
  console.log(
    `[cutover] 이 환경(${report.environment})은 전환 대상이 아닙니다 — ` +
      "실 Provider 전환은 production·staging에서 수행합니다 (CTO 정책 3501-①). " +
      "위 판정은 참고용입니다.",
  );
  process.exit(0);
}

console.error(`[cutover] ${activation.detail}`);
process.exit(1);

#!/usr/bin/env node
/**
 * CI/CD Deployment Gate. (TASK-1302, Sprint 13 — CTO 결정 1202-④)
 *
 * 배포 파이프라인이 `/health/ready`를 호출해 **배포 가능 여부를 자동으로
 * 판정**한다. 사람이 화면을 보고 판단하던 것을 기계가 대신한다.
 *
 * 판정:
 *   exit 0 — 배포 가능 (blocking 실패 없음)
 *   exit 1 — 배포 불가 (차단 항목 존재)
 *   exit 2 — 판정 불가 (API 접근 실패·인증 실패) — **통과로 처리하지 않는다**
 *
 * 판정할 수 없을 때 0을 돌려주면 게이트가 있으나 마나 하다. 확인하지 못한
 * 것은 통과가 아니다(체크리스트의 manual 처리와 같은 태도).
 *
 * 사용법:
 *   API_BASE=https://<api-host> \
 *   GATE_EMAIL=admin@acos.local GATE_PASSWORD=... \
 *     node scripts/deployment-gate.mjs
 *
 * 옵션:
 *   GATE_ALLOW_WARN=1   경고(warn)가 있어도 통과시킨다 (기본: 통과 — 경고는
 *                       배포를 막지 않는다. blocking 실패만 막는다)
 *   GATE_STRICT=1       직접 확인(manual) 항목이 있으면 배포를 막는다
 *   GATE_ALERTS=1       활성 critical 경보가 있으면 배포를 막는다
 */
const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const GATE_EMAIL = process.env.GATE_EMAIL ?? "admin@acos.local";
const GATE_PASSWORD = process.env.GATE_PASSWORD ?? "admin1234";
const STRICT = process.env.GATE_STRICT === "1";
const CHECK_ALERTS = process.env.GATE_ALERTS === "1";

let authToken = "";
let authCookie = "";

async function api(path, init) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(authCookie ? { cookie: authCookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

function fail(message, code) {
  console.error(`✖ ${message}`);
  process.exitCode = code;
}

async function login() {
  const auth = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: GATE_EMAIL, password: GATE_PASSWORD }),
  });
  const setCookie = auth.headers?.get("set-cookie") ?? "";
  const cookieMatch = /acos_session=[0-9a-f]+/.exec(setCookie);
  if (auth.status !== 200 || !(auth.body?.token || cookieMatch)) {
    return false;
  }
  authToken = auth.body?.token ?? "";
  // 운영은 쿠키 전용 모드(TASK-0804)라 본문 토큰이 없다
  authCookie = cookieMatch ? cookieMatch[0] : "";
  return true;
}

async function main() {
  console.log(`# Deployment Gate — ${API_BASE}`);

  if (!(await login())) {
    // 판정할 수 없다 — 통과로 처리하지 않는다
    return fail(
      "ADMIN 로그인 실패 — 배포 가능 여부를 판정할 수 없습니다 (GATE_EMAIL/GATE_PASSWORD 확인).",
      2,
    );
  }

  const ready = await api("/health/ready");
  if (ready.status !== 200 || !ready.body) {
    return fail(
      `배포 준비 보고를 가져오지 못했습니다 — HTTP ${ready.status} (판정 불가).`,
      2,
    );
  }

  const report = ready.body;
  const summary = report.summary ?? {};
  console.log(
    `환경: ${report.nodeEnv} · 통과 ${summary.pass ?? 0} · 실패 ${summary.fail ?? 0} · ` +
      `경고 ${summary.warn ?? 0} · 직접 확인 ${summary.manual ?? 0}`,
  );

  const blockers = summary.blockers ?? [];
  for (const item of blockers) {
    console.error(`  ⛔ ${item.title} — ${item.detail}`);
  }

  const manual = (report.checklist ?? []).filter(
    (item) => item.status === "manual",
  );
  for (const item of manual) {
    console.log(`  … ${item.title} — ${item.detail} (직접 확인)`);
  }

  let blocked = false;

  if (!report.ready || blockers.length > 0) {
    fail(`배포 불가 — 차단 항목 ${blockers.length}건.`, 1);
    blocked = true;
  }

  if (STRICT && manual.length > 0) {
    fail(
      `GATE_STRICT=1 — 직접 확인 항목 ${manual.length}건이 남아 있습니다.`,
      1,
    );
    blocked = true;
  }

  if (CHECK_ALERTS) {
    const board = await api("/ops/alerts");
    if (board.status !== 200 || !board.body) {
      fail(
        `경보 현황을 가져오지 못했습니다 — HTTP ${board.status} (판정 불가).`,
        2,
      );
      blocked = true;
    } else {
      const critical = (board.body.active ?? []).filter(
        (alert) => alert.level === "critical",
      );
      for (const alert of critical) {
        console.error(`  ⛔ 경보: ${alert.title} — ${alert.message}`);
      }
      if (critical.length > 0) {
        fail(`활성 critical 경보 ${critical.length}건 — 배포를 막습니다.`, 1);
        blocked = true;
      } else {
        console.log(
          `경보: 활성 ${board.body.summary?.total ?? 0}건 (critical 0) — 통과`,
        );
      }
    }
  }

  if (!blocked) {
    console.log("\n✔ 배포 가능 — 차단 항목 없음");
    process.exitCode = 0;
  }
}

main().catch((error) => {
  // 예외도 판정 불가다 — 조용히 통과시키지 않는다
  console.error(`게이트 실행 오류: ${error.message}`);
  process.exitCode = 2;
});

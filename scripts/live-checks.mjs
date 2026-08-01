#!/usr/bin/env node
/**
 * 라이브 검사 — CI에서 돌 수 있는 것만. (TASK-4701, Sprint 47 — 지시 4)
 *
 * ## 이것은 라이브 검증이 아닙니다
 *
 * 가장 중요한 문장을 맨 앞에 둡니다. 이 스크립트는 **실 PostgreSQL과 우리
 * 스텁**을 상대로 돕니다. 그것이 증명하는 것은 **배선이 맞는가**이고,
 * 증명하지 않는 것은 **실제 Provider가 우리 요청을 어떻게 대하는가**입니다.
 *
 * 둘을 같은 이름으로 부르면, 어느 날 CI가 초록인 것을 보고 "라이브 검증이
 * 끝났다"고 말하게 됩니다. TASK-3501에서 스텁 상대 성공 기록을 "연결됨"으로
 * 셀 뻔한 것과 같은 사고입니다.
 *
 * ## 왜 유닛 테스트로 안 되는가
 *
 * TASK-4603에서 라이브 결함 4건이 나왔고 **넷 다 유닛 테스트를
 * 통과했습니다.** 인메모리 mock은 우리가 상상한 대로 동작하고, 실제 DB는
 * 우리가 쓴 대로 동작합니다 — 그 둘이 어긋나는 자리에서 사고가 납니다.
 *
 * ## 어떻게 쓰는가
 *
 *   API_BASE=http://127.0.0.1:4000 \
 *   ADMIN_EMAIL=admin@acos.local ADMIN_PASSWORD=admin1234 \
 *   VISION_STUB=http://127.0.0.1:9100 \
 *   pnpm live:checks
 *
 * 판정:
 *   exit 0 — 전부 통과
 *   exit 1 — 하나라도 실패 (무엇이 왜 실패했는지 출력한다)
 *   exit 2 — 검사를 시작할 수 없음 — **통과로 처리하지 않는다**
 */

const BASE = process.env.API_BASE ?? "http://127.0.0.1:4000";
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@acos.local";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin1234";
/**
 * 스텁을 죽였다 살리는 검사를 하려면 스텁을 우리가 제어할 수 있어야 합니다.
 *
 * 값은 계약 스텁의 주소입니다 (`POST {주소}/__mode {"mode":"outage"|"ok"}`).
 * 없으면 그 검사를 **판정하지 않습니다** — 못 돌린 것을 통과로 세지
 * 않습니다.
 */
const VISION_STUB_CONTROL = process.env.VISION_STUB_CONTROL ?? null;

/**
 * 스텁 모드를 바꾼다 — **실패를 삼키지 않습니다.**
 *
 * 처음에는 `.catch(() => null)`로 두었는데, 그러면 조건을 못 만들어 놓고
 * 검사를 돌리게 됩니다. 그때 나오는 "멈추지 않았습니다"는 **제품이
 * 틀렸다는 뜻이 아니라 검사가 틀렸다는 뜻**이고, 그 둘을 구별할 수
 * 없으면 검사 결과를 믿을 수 없습니다.
 */
async function setStubMode(mode) {
  const response = await fetch(`${VISION_STUB_CONTROL}/__mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) {
    throw new Error(`스텁 모드를 "${mode}"로 바꾸지 못했습니다 (HTTP ${response.status})`);
  }
}

let cookie = "";
const results = [];

function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${id} — ${detail}`);
}

async function call(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(cookie === "" ? {} : { cookie }),
      ...(options.headers ?? {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie !== null) {
    cookie = setCookie.split(";")[0];
  }
  const text = await response.text();
  // 본문이 JSON이 아닐 수도 있습니다 — 그때는 원문 그대로 돌려줍니다.
  // 파싱 실패를 삼키고 `null`로 만들면 "응답이 비었다"와 구별할 수 없습니다.
  let body;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, text };
}

async function login() {
  const response = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`로그인 실패 (HTTP ${response.status}): ${response.text.slice(0, 200)}`);
  }
}

// ── 검사들 ───────────────────────────────────────────────────

/**
 * 검사에 쓸 이미지를 고른다.
 *
 * `IMAGE_IDS`로 직접 줄 수 있고, 없으면 OCR 이력에서 **이미 성공한 적이
 * 있는** 이미지를 고릅니다. 성공한 적 있는 것을 고르는 이유: 이 검사가
 * 보려는 것은 "OCR이 되는가"가 아니라 **작업 층이 제대로 도는가**입니다.
 * 읽히지 않는 이미지를 골라 놓고 층이 잘못됐다고 말하면 그건 오진입니다.
 *
 * 하나도 못 고르면 **판정하지 않습니다** — 검사를 못 돌린 것을 통과로
 * 세지 않습니다.
 */
async function seedImages(count) {
  const given = (process.env.IMAGE_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (given.length > 0) {
    return given.slice(0, count);
  }

  const results = await call("/ocr/results?take=200");
  const rows = Array.isArray(results.body?.results) ? results.body.results : [];
  const succeeded = rows
    .filter((row) => row.status === "SUCCESS")
    .map((row) => row.imageId);
  const unique = [...new Set(succeeded)];
  return unique.slice(0, count);
}

/**
 * 묶음이 끝까지 도는가.
 *
 * **"끝났다"만 보면 안 됩니다** (TASK-4801에서 고침). 모든 항목이
 * 건너뛰어져도 작업은 `succeeded`입니다 — 한 건의 문제로 건너뛰는 것은
 * 정상 동작이기 때문입니다. 그래서 상태만 보는 검사는 **저장소 설정이
 * 통째로 틀린 상태에서도 초록**이 됩니다.
 *
 * 실제로 그렇게 됐습니다: s3rver가 다른 디렉터리를 보고 있어 이미지를
 * 하나도 못 읽었는데 이 검사는 통과했습니다. **초록일 수 있는 게이트는
 * 게이트가 아닙니다.**
 *
 * 그래서 **일을 실제로 했는지**까지 봅니다.
 */
async function checkBatchSucceeds(imageIds) {
  const response = await call("/jobs/ocr-batch", {
    method: "POST",
    body: JSON.stringify({ imageIds }),
  });
  const job = response.body?.job;
  const finished = response.status === 200 && job?.status === "succeeded";
  // 건너뛴 것이 있으면 그만큼 **얻은 것이 없습니다.**
  const skipped = typeof job?.detail === "string" && job.detail.includes("건너뛴 항목");
  const ok = finished && !skipped;
  record(
    "job-batch-succeeds",
    ok,
    ok
      ? `${job.completedStages.length}/${job.totalStages}단계 · ${job.totalMs}ms · 건너뛴 항목 없음`
      : finished
        ? `끝나기는 했지만 얻은 것이 없습니다: ${job.detail.slice(0, 160)}`
        : `HTTP ${response.status} · ${JSON.stringify(response.body).slice(0, 200)}`,
  );
  return job ?? null;
}

async function checkMetricsRecorded(jobId) {
  const detail = await call(`/jobs/${jobId}`);
  const metrics = detail.body?.metrics ?? [];
  const perf = detail.body?.perf;
  const ok = metrics.length > 0 && typeof perf?.totalMs === "number";
  record(
    "token-detail-recorded",
    ok,
    ok
      ? `단계 ${metrics.length}개 계측 · ${perf.detail.slice(0, 120)}`
      : "계측이 남지 않았습니다",
  );

  // 비용은 **모를 수 있습니다** — 그때 null이어야 하고 0이면 안 됩니다.
  const costOk =
    perf !== undefined &&
    (perf.costUsd === null || typeof perf.costUsd === "number") &&
    metrics.every(
      (metric) => metric.costUsd === null || typeof metric.costUsd === "number",
    );
  record(
    "cost-of-a-job",
    costOk,
    costOk
      ? `작업 비용 ${perf.costUsd === null ? "모름(null)" : `$${perf.costUsd}`} · 미산정 ${perf.unpricedCalls}건`
      : "비용 칸의 모양이 약속과 다릅니다",
  );
}

async function ocrRecordCount() {
  const response = await call("/ocr/results?take=200");
  return Array.isArray(response.body?.results) ? response.body.results.length : null;
}

async function checkCheckpointSavesMoney(imageIds, jobId) {
  const beforeCount = await ocrRecordCount();
  const again = await call(`/jobs/${jobId}/resume`, { method: "POST" });
  const afterCount = await ocrRecordCount();

  // 총계를 못 읽으면 **통과로 처리하지 않습니다.**
  if (beforeCount === null || afterCount === null) {
    record(
      "job-checkpoint-saves-money",
      false,
      "OCR 기록 수를 읽지 못해 판정하지 않았습니다 — 모르는 것을 통과로 세지 않습니다.",
    );
    return;
  }
  const ok = again.status === 200 && afterCount === beforeCount;
  record(
    "job-checkpoint-saves-money",
    ok,
    ok
      ? `OCR 기록 ${beforeCount} → ${afterCount} (다시 사지 않음)`
      : `OCR 기록 ${beforeCount} → ${afterCount} — 끝난 단계를 다시 샀습니다`,
  );
}

async function checkResumeKeepsRow(imageIds) {
  const before = await call("/jobs?take=100");
  const beforeIds = new Set((before.body?.jobs ?? []).map((row) => row.id));

  // 상대를 죽인 상태에서 한 번 실패시킵니다.
  if (VISION_STUB_CONTROL === null) {
    record(
      "job-resume-same-row",
      false,
      "스텁을 제어할 수 없어 판정하지 않았습니다 (VISION_STUB_CONTROL 미설정) — 모르는 것을 통과로 세지 않습니다.",
    );
    record(
      "job-provider-down-stops",
      false,
      "같은 이유로 판정하지 않았습니다.",
    );
    return;
  }

  // 503 — 상대 서버가 죽은 것이고, 이것은 **다시 해 볼 만한 실패**입니다.
  try {
    await setStubMode("outage");
  } catch (error) {
    record("job-provider-down-stops", false, `조건을 만들지 못했습니다: ${String(error)}`);
    record("job-resume-same-row", false, "같은 이유로 판정하지 않았습니다.");
    return;
  }
  const failed = await call("/jobs/ocr-batch", {
    method: "POST",
    body: JSON.stringify({ imageIds }),
  });
  const failedJob = failed.body?.job;
  const stopped = failedJob?.status === "failed" && failedJob?.resumable === true;
  record(
    "job-provider-down-stops",
    stopped,
    stopped
      ? `상대가 죽자 배치를 멈췄습니다 (${failedJob.failureKind} · 이어할 수 있음)`
      : `멈추지 않았습니다: ${JSON.stringify(failedJob).slice(0, 200)}`,
  );

  await setStubMode("ok");
  const resumed = await call(`/jobs/${failedJob?.id}/resume`, { method: "POST" });
  const after = await call("/jobs?take=100");
  const newRows = (after.body?.jobs ?? []).filter((row) => !beforeIds.has(row.id));

  // 새 행이 **하나만** 늘어야 합니다 — 이어하기가 또 하나를 만들면 둘입니다.
  const ok =
    resumed.body?.job?.status === "succeeded" &&
    resumed.body?.job?.id === failedJob?.id &&
    newRows.length === 1;
  record(
    "job-resume-same-row",
    ok,
    ok
      ? `같은 행에 이어 썼습니다 (시도 ${resumed.body.job.attempts}회 · 새 행 1개)`
      : `새 행 ${newRows.length}개 — 앞의 시도가 없던 일이 됩니다`,
  );
}

async function checkBlockedNotRetried() {
  // 예산을 0으로 막고 부릅니다. 예산은 기다린다고 열리지 않으므로
  // "잠시 후 다시 시도"라고 말하면 안 됩니다.
  const response = await call("/jobs/ocr-batch", {
    method: "POST",
    body: JSON.stringify({ imageIds: ["definitely-missing-image"] }),
  });
  const job = response.body?.job;
  const ok =
    job !== undefined &&
    (job.status === "succeeded" || job.status === "failed") &&
    (job.userMessage === null || !job.userMessage.includes("잠시 후 다시 시도"));
  record(
    "job-blocked-not-retried",
    ok,
    ok
      ? "없는 이미지에 '잠시 후 다시 시도'라고 말하지 않았습니다"
      : `사용자 문장이 재시도를 권합니다: ${job?.userMessage}`,
  );
}

async function checkAutoResume() {
  const status = await call("/jobs/queue/status");
  const ok = status.status === 200 && typeof status.body?.enabled === "boolean";
  record(
    "auto-resume-orphan",
    ok,
    ok
      ? `자동 이어하기 ${status.body.enabled ? "켜짐" : "꺼짐"} · 등록된 종류 ${status.body.kinds.length}종`
      : `상태를 읽지 못했습니다 (HTTP ${status.status})`,
  );

  const sweep = await call("/jobs/queue/sweep", { method: "POST" });
  const sweepOk = sweep.status === 200 && typeof sweep.body?.scanned === "number";
  record(
    "auto-resume-holds-blocked",
    sweepOk,
    sweepOk
      ? `훑기: ${sweep.body.detail.slice(0, 160)}`
      : `훑지 못했습니다 (HTTP ${sweep.status})`,
  );
}

async function checkExistingResponsesUnchanged() {
  // 전역 예외 필터가 붙은 뒤에도 기존 응답이 그대로인가.
  const missing = await call("/projects/definitely-missing-project");
  const ok404 =
    missing.status === 404 &&
    missing.body?.statusCode === 404 &&
    missing.body?.error === "Not Found" &&
    // 새 칸이 옛 응답에 끼어들면 안 됩니다.
    missing.body?.requestId === undefined;
  record(
    "existing-responses-unchanged",
    ok404,
    ok404
      ? "404 본문이 예전과 같습니다 (requestId가 끼어들지 않음)"
      : `달라졌습니다: ${JSON.stringify(missing.body).slice(0, 200)}`,
  );
}

async function checkNoSecretsInLogs(jobId) {
  const events = await call(`/jobs/${jobId}/events`);
  const rows = events.body?.events ?? [];
  const text = JSON.stringify(rows);
  // 값의 모양이 아니라 **이름**으로 가립니다 — 그래서 여기서도 이름을 봅니다.
  const leaked = /"(?:[^"]*(?:key|token|secret|password|authorization|cookie|webhook)[^"]*)"\s*:\s*"(?!\[가림\])[^"]{8,}"/i.exec(
    text,
  );
  const ok = leaked === null;
  record(
    "logs-have-no-secrets",
    ok,
    ok
      ? `로그 ${rows.length}줄 · 비밀처럼 보이는 값 0건`
      : `가려지지 않은 값이 있습니다: ${leaked[0].slice(0, 80)}`,
  );
}

// ── 실행 ────────────────────────────────────────────────────

console.log("라이브 검사 (CI 가능 범위) — 실 DB + 우리 스텁\n");
console.log(
  "이 검사가 증명하는 것은 배선이 맞는가입니다. 실제 Provider가 우리 요청을\n" +
    "어떻게 대하는지는 증명하지 않습니다.\n",
);

try {
  await login();
} catch (error) {
  console.error(`[live-checks] 시작할 수 없습니다: ${String(error)}`);
  console.error("  검사를 못 돌린 것을 통과로 처리하지 않습니다.");
  process.exit(2);
}

const imageIds = await seedImages(3);
if (imageIds.length === 0) {
  console.error("[live-checks] 검사에 쓸 이미지가 없습니다 — 판정할 수 없습니다.");
  process.exit(2);
}

const job = await checkBatchSucceeds(imageIds);
if (job !== null) {
  await checkMetricsRecorded(job.id);
  await checkCheckpointSavesMoney(imageIds, job.id);
  await checkNoSecretsInLogs(job.id);
}
await checkResumeKeepsRow(imageIds);
await checkBlockedNotRetried();
await checkAutoResume();
await checkExistingResponsesUnchanged();

const failed = results.filter((row) => !row.ok);
console.log(
  `\n검사 ${results.length}건 · 통과 ${results.length - failed.length}건 · 실패 ${failed.length}건`,
);

if (failed.length > 0) {
  console.error("\n실패한 검사:");
  for (const row of failed) {
    console.error(`  ✗ ${row.id} — ${row.detail}`);
  }
  process.exit(1);
}
process.exit(0);

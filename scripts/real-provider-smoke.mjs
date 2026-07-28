#!/usr/bin/env node
/**
 * 실제 Provider 스모크 테스트. (TASK-0703, Sprint 7)
 *
 * 운영/스테이징 환경(실 API 키 + egress 허용)에서 LLM 파이프라인 전 경로를
 * 1회씩 실행하고 Execution 지표로 판정한다. 개발 환경 리허설은
 * SMOKE_ALLOW_MOCK=1 로 mock Provider를 허용한다.
 *
 * 사용법:
 *   API_BASE=https://<api-host> [PROJECT_ID=..] [PRODUCT_ID=..] \
 *     node scripts/real-provider-smoke.mjs
 *
 * 판정: 모든 단계 통과 시 exit 0, 하나라도 실패하면 exit 1.
 */
const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const ALLOW_MOCK = process.env.SMOKE_ALLOW_MOCK === "1";

const results = [];
let failed = false;

function report(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${step}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failed = true;
  }
}

async function api(path, init) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`# Real Provider Smoke — ${API_BASE} (${startedAt})`);

  // 1. Provider 확인
  const info = await api("/llm");
  const provider = info.body?.provider;
  if (info.status !== 200) {
    report("Provider 확인 (GET /llm)", false, `HTTP ${info.status}`);
  } else if (provider === "mock" && !ALLOW_MOCK) {
    report(
      "Provider 확인 (GET /llm)",
      false,
      "provider=mock — 실키 환경이 아닙니다 (리허설은 SMOKE_ALLOW_MOCK=1)",
    );
  } else {
    report(
      "Provider 확인 (GET /llm)",
      true,
      `${provider} / ${info.body.defaultModel}${provider === "mock" ? " (mock 리허설)" : ""}`,
    );
  }
  if (failed) {
    return finish();
  }

  // 2. Health Check (실호출)
  const health = await api("/llm/health");
  report(
    "Health Check (GET /llm/health)",
    health.status === 200 && health.body?.status === "ok",
    health.body?.status === "ok"
      ? `${health.body.latencyMs}ms`
      : (health.body?.error ?? `HTTP ${health.status}`),
  );

  // 3. 대상 프로젝트/상품 결정 (미지정 시 자동 탐색)
  let projectId = process.env.PROJECT_ID;
  let productId = process.env.PRODUCT_ID;
  if (!projectId || !productId) {
    const products = await api("/products");
    const first = products.body?.products?.[0];
    projectId = projectId ?? first?.projectId;
    productId = productId ?? first?.id;
  }
  if (!projectId || !productId) {
    report("대상 탐색", false, "PROJECT_ID/PRODUCT_ID를 지정해 주세요");
    return finish();
  }
  report("대상 탐색", true, `project=${projectId} product=${productId}`);

  // 4. Vision 포함 조립 (이미지 가드 경유)
  const po = await api(`/projects/${projectId}/product-object`, {
    method: "POST",
  });
  report(
    "Vision 조립 (POST …/product-object)",
    po.status === 201 && po.body?.visionSummary !== null,
    po.status === 201
      ? `visionSummary.source=${po.body?.visionSummary?.source ?? "null(폴백)"}`
      : `HTTP ${po.status}`,
  );

  // 5. READY 전이 (상세페이지 생성 전제 조건)
  if (po.status === 201) {
    const ready = await api(
      `/projects/${projectId}/product-object/${po.body.version}/status`,
      { method: "PATCH", body: JSON.stringify({ status: "READY" }) },
    );
    report(
      "READY 전이 (PATCH …/status)",
      ready.status === 200,
      ready.status === 200
        ? `v${po.body.version} READY`
        : `HTTP ${ready.status}: ${ready.body?.message ?? ""}`,
    );
  }

  // 6. 분석
  const analysis = await api(`/products/${productId}/analysis`, {
    method: "POST",
    body: "{}",
  });
  report(
    "분석 (POST …/analysis)",
    analysis.status === 201 && analysis.body?.status === "SUCCESS",
    analysis.body?.status
      ? `${analysis.body.status} (${analysis.body.provider})`
      : `HTTP ${analysis.status}`,
  );

  // 7. 상세페이지 생성 (READY PO 필요)
  const content = await api(`/projects/${projectId}/contents/generate`, {
    method: "POST",
    body: "{}",
  });
  report(
    "상세페이지 생성 (POST …/contents/generate)",
    content.status === 201,
    content.status === 201
      ? `content=${content.body.id}`
      : `HTTP ${content.status}: ${content.body?.message ?? ""}`,
  );

  // 8. Execution 지표 판정 (이 실행 구간)
  const stats = await api(
    `/executions/stats?from=${encodeURIComponent(startedAt)}`,
  );
  const totals = stats.body?.totals;
  const enough = (totals?.count ?? 0) >= 4 && totals.failedCount === 0;
  report(
    "Execution 지표 (GET /executions/stats)",
    stats.status === 200 && enough,
    totals
      ? `count=${totals.count} success=${totals.successCount} failed=${totals.failedCount} ` +
          `tokens=${totals.inputTokens}/${totals.outputTokens} cost=${totals.cost ?? "미산정"}`
      : `HTTP ${stats.status}`,
  );
  if (provider !== "mock" && totals && totals.cost === null) {
    report(
      "비용 산정",
      false,
      "실 Provider인데 cost가 미산정 — 가격표(DEFAULT_LLM_PRICING) 확인 필요",
    );
  }

  return finish();
}

function finish() {
  const passed = results.filter((item) => item.ok).length;
  console.log(`\n결과: ${passed}/${results.length} 통과 — ${failed ? "FAIL" : "PASS"}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error("스모크 실행 오류:", error.message);
  process.exitCode = 1;
});

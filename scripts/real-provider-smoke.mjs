#!/usr/bin/env node
/**
 * 실제 Provider 스모크 테스트. (TASK-0703, Sprint 7)
 *
 * 운영/스테이징 환경(실 API 키 + egress 허용)에서 LLM 파이프라인 전 경로를
 * 1회씩 실행하고 Execution 지표로 판정한다. 개발 환경 리허설은
 * SMOKE_ALLOW_MOCK=1 로 mock Provider를 허용한다.
 *
 * TASK-1301(Sprint 13)에서 추가된 것:
 * - API Key 검증 (형식 + 선택적 Live Check) — ADMIN 계정일 때만 판정
 * - 키가 설정된 **모든** Provider의 Health Check (라우팅·Failover 대비)
 * - Vision(vision-analysis) 커버리지 필수화
 * - 비용 검증(Cost Verification)과 운영 모니터링(Production Monitoring)
 *
 * 사용법:
 *   API_BASE=https://<api-host> [PROJECT_ID=..] [PRODUCT_ID=..] \
 *     [SMOKE_LIVE_CHECK=1] node scripts/real-provider-smoke.mjs
 *
 * SMOKE_LIVE_CHECK=1은 Provider마다 최소 완성 호출을 1회 더 실행한다
 * (실제 과금 발생) — 키 교체 직후 확인용.
 *
 * 판정: 모든 단계 통과 시 exit 0, 하나라도 실패하면 exit 1.
 * ADMIN 권한이 없어 건너뛴 항목은 "…"로 표시되며 실패로 세지 않는다.
 */
const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const ALLOW_MOCK = process.env.SMOKE_ALLOW_MOCK === "1";
// TASK-0802: 모든 쓰기 API 인증 — 스모크는 EDITOR 이상 계정으로 로그인한다
const SMOKE_EMAIL = process.env.SMOKE_EMAIL ?? "admin@acos.local";
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD ?? "admin1234";

const results = [];
let failed = false;
let authToken = "";
let authCookie = ""; // 쿠키 전용 운영 모드 (TASK-0804/0901) — 본문 토큰이 없다

function report(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${step}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failed = true;
  }
}

/** 판정하지 않고 알리기만 한다 (권한 부족 등 — 실패로 세지 않는다) */
function note(step, detail) {
  console.log(`… ${step} — ${detail}`);
}

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

  // 2. 로그인 (TASK-0802 — 쓰기 API 인증)
  // 운영은 쿠키 전용 모드(TASK-0804)라 본문 토큰이 없다 — Set-Cookie를 사용
  const auth = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }),
  });
  const setCookie = auth.headers?.get("set-cookie") ?? "";
  const cookieMatch = /acos_session=[0-9a-f]+/.exec(setCookie);
  if (auth.status === 200 && (auth.body?.token || cookieMatch)) {
    authToken = auth.body?.token ?? "";
    authCookie = cookieMatch ? cookieMatch[0] : "";
    report(
      "로그인 (POST /auth/login)",
      true,
      `${auth.body.user.email} (${auth.body.user.role})` +
        (authToken ? "" : " — 쿠키 전용 모드"),
    );
  } else {
    report(
      "로그인 (POST /auth/login)",
      false,
      auth.body?.message ?? `HTTP ${auth.status} — SMOKE_EMAIL/SMOKE_PASSWORD 확인`,
    );
    return finish();
  }

  // 3. Health Check (실호출)
  const health = await api("/llm/health");
  report(
    "Health Check (GET /llm/health)",
    health.status === 200 && health.body?.status === "ok",
    health.body?.status === "ok"
      ? `${health.body.latencyMs}ms`
      : (health.body?.error ?? `HTTP ${health.status}`),
  );

  // 3-a. API Key Validation (TASK-1301) — ADMIN 전용, 형식 + Live Check
  // 실호출은 SMOKE_LIVE_CHECK=1일 때만 (기본은 형식 검사 — 불필요한 과금 방지)
  const liveCheck = process.env.SMOKE_LIVE_CHECK === "1";
  const validation = await api(
    `/llm/providers/validate${liveCheck ? "?live=1" : ""}`,
  );
  if (validation.status === 401 || validation.status === 403) {
    note(
      "API Key 검증 (GET /llm/providers/validate)",
      "ADMIN 계정이 아니어서 건너뜁니다 (판정 아님)",
    );
  } else {
    report(
      "API Key 검증 (GET /llm/providers/validate)",
      validation.status === 200 && validation.body?.ok === true,
      validation.status === 200
        ? (validation.body.blockers ?? []).join(" / ") ||
            `${validation.body.providers.length}개 Provider 형식 정상` +
              (liveCheck ? " (Live Check 포함)" : " (형식만 — Live Check 미실행)")
        : `HTTP ${validation.status}`,
    );
  }

  // 3-b. 키가 설정된 Provider 전부 Health Check (TASK-1301)
  // 라우팅·Failover로 어느 Provider든 실제로 쓰일 수 있다 — 기본 하나만
  // 확인하면 전환되는 순간 장애를 처음 알게 된다.
  const registry = await api("/llm/providers");
  const configured = (registry.body?.providers ?? [])
    .filter((entry) => entry.keyConfigured && entry.name !== "mock")
    .map((entry) => entry.name);
  if (configured.length === 0) {
    note("Provider별 Health Check", "실 Provider 키가 없습니다 (mock 리허설)");
  }
  for (const name of configured) {
    const result = await api(`/llm/health?provider=${encodeURIComponent(name)}`);
    report(
      `Provider Health (${name})`,
      result.status === 200 && result.body?.status === "ok",
      result.body?.status === "ok"
        ? `${result.body.model} ${result.body.latencyMs}ms`
        : (result.body?.error ?? `HTTP ${result.status}`),
    );
  }

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
  // 9. 운영 판정 (TASK-0901) — Provider·Feature 커버리지 + 비용 가시성
  const providerKeys = (stats.body?.byProvider ?? []).map((item) => item.key);
  const featureKeys = (stats.body?.byFeature ?? []).map((item) => item.key);
  const requiredFeatures = [
    "product-analysis",
    "content-generation",
    // Vision Production (TASK-1301) — 이미지 전달 형식은 Provider마다 다르다.
    // 빠지면 "이미지 없이 추측한 결과"가 정상처럼 기록된다.
    "vision-analysis",
  ];
  const missingFeatures = requiredFeatures.filter(
    (key) => !featureKeys.includes(key),
  );
  const providerCovered = providerKeys.includes(provider);
  report(
    "운영 판정 (Provider·Feature 커버리지)",
    providerCovered && missingFeatures.length === 0,
    `byProvider=[${providerKeys.join(",")}] byFeature=[${featureKeys.join(",")}]` +
      (missingFeatures.length > 0 ? ` — 누락: ${missingFeatures.join(",")}` : ""),
  );
  if (provider !== "mock" && totals && !(totals.cost > 0)) {
    report(
      "비용 산정",
      false,
      `실 Provider인데 cost=${totals.cost ?? "미산정"} — 가격표(DEFAULT_LLM_PRICING)·모델명 확인 필요`,
    );
  }

  // 10. Cost Verification (TASK-1301) — 기록된 비용이 가격표와 맞는가
  const costCheck = await api("/llm/cost-verification?hours=1");
  if (costCheck.status === 401 || costCheck.status === 403) {
    note("비용 검증 (GET /llm/cost-verification)", "ADMIN 계정이 아니어서 건너뜁니다");
  } else {
    report(
      "비용 검증 (GET /llm/cost-verification)",
      costCheck.status === 200 && costCheck.body?.ok === true,
      costCheck.status === 200
        ? `${costCheck.body.checked}건 검사 · 기록 $${costCheck.body.recordedTotal} · 미산정 ${costCheck.body.unpricedCalls}건` +
            (costCheck.body.issues?.length
              ? ` — ${costCheck.body.issues.map((issue) => `${issue.model}(${issue.kind})`).join(", ")}`
              : "")
        : `HTTP ${costCheck.status}`,
    );
  }

  // 11. Production Monitoring (TASK-1301) — 성공률·지연·경보
  const monitoring = await api("/llm/monitoring?minutes=60");
  if (monitoring.status === 401 || monitoring.status === 403) {
    note("운영 모니터링 (GET /llm/monitoring)", "ADMIN 계정이 아니어서 건너뜁니다");
  } else {
    const critical = (monitoring.body?.alerts ?? []).filter(
      (alert) => alert.level === "critical",
    );
    report(
      "운영 모니터링 (GET /llm/monitoring)",
      monitoring.status === 200 && critical.length === 0,
      monitoring.status === 200
        ? `상태=${monitoring.body.status} 호출=${monitoring.body.totals.calls} ` +
            `성공률=${monitoring.body.totals.successRate ?? "판정불가"}` +
            (monitoring.body.alerts.length
              ? ` — 경보 ${monitoring.body.alerts.length}건: ${monitoring.body.alerts.map((alert) => alert.message).join(" / ")}`
              : "")
        : `HTTP ${monitoring.status}`,
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

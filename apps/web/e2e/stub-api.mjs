// 스텁 Execution API (TASK-0702) — 웹 스모크 테스트 전용.
// POST /__mode { mode: "data" | "empty" | "error" } 로 응답 상태를 전환하고,
// GET /__last 로 마지막 수신 쿼리를 확인한다 (필터 전달 검증용).
import http from "node:http";

const PORT = 4999;
let mode = "data";
let lastUrls = [];

const stats = (totals, groups) => ({
  range: { from: null, to: null },
  totals,
  byFeature: groups,
  // Provider 비교 (TASK-0903) — 다중 Provider 비교 렌더링 검증용
  byProvider: groups.length
    ? [
        { key: "mock", stats: totals },
        {
          key: "anthropic",
          stats: {
            count: 4,
            successCount: 3,
            failedCount: 1,
            successRate: 0.75,
            failureRate: 0.25,
            inputTokens: 4000,
            outputTokens: 1600,
            cost: 0.06,
            avgLatencyMs: 850.4,
            maxLatencyMs: 1200,
          },
        },
      ]
    : [],
  byModel: groups.length
    ? [{ key: "mock-llm-1", stats: totals }]
    : [],
  // Routing Metrics (TASK-1001) — 경로(feature→provider)별 집계
  byRoute: groups.length
    ? [
        { key: "content-generation→mock", stats: totals },
        {
          key: "product-analysis→anthropic",
          stats: {
            count: 4,
            successCount: 3,
            failedCount: 1,
            successRate: 0.75,
            failureRate: 0.25,
            inputTokens: 4000,
            outputTokens: 1600,
            cost: 0.06,
            avgLatencyMs: 850.4,
            maxLatencyMs: 1200,
          },
        },
      ]
    : [],
  // Experiment Metrics (TASK-1003) — 변형(feature→provider:model)별 집계
  byVariant: groups.length
    ? [
        {
          key: "product-analysis→openai:gpt-4o",
          stats: {
            count: 91,
            successCount: 89,
            failedCount: 2,
            successRate: 0.978,
            failureRate: 0.022,
            inputTokens: 91000,
            outputTokens: 27300,
            cost: 1.2345,
            avgLatencyMs: 910.2,
            maxLatencyMs: 1500,
          },
        },
        {
          key: "product-analysis→anthropic:claude-sonnet-5",
          stats: {
            count: 9,
            successCount: 9,
            failedCount: 0,
            successRate: 1,
            failureRate: 0,
            inputTokens: 9000,
            outputTokens: 2700,
            cost: 0.234,
            avgLatencyMs: 1450.7,
            maxLatencyMs: 2100,
          },
        },
      ]
    : [],
});

const DATA_TOTALS = {
  count: 9,
  successCount: 8,
  failedCount: 1,
  successRate: 0.8889,
  failureRate: 0.1111,
  inputTokens: 1002,
  outputTokens: 324,
  cost: 0,
  avgLatencyMs: 11.1,
  maxLatencyMs: 97,
};

const EMPTY_TOTALS = {
  count: 0,
  successCount: 0,
  failedCount: 0,
  successRate: null,
  failureRate: null,
  inputTokens: 0,
  outputTokens: 0,
  cost: null,
  avgLatencyMs: null,
  maxLatencyMs: null,
};

// 사용자 관리 스텁 상태 (TASK-0802) — /__mode 전환 시 초기화
let stubUsers;
let stubAudit;
let stubPassword; // 관리자 비밀번호 (TASK-0803 변경 흐름 검증용)
let stubFailedLogins; // 연속 실패 횟수 (TASK-0804 잠금 검증용, 임계 5회)
let stubLocked;
function resetUsers() {
  stubUsers = [
    {
      id: "u-admin",
      email: "admin@acos.local",
      name: "관리자",
      role: "ADMIN",
      disabled: false,
      lockedUntil: null,
      createdAt: "2026-07-28T00:00:00.000Z",
    },
  ];
  stubAudit = [];
  stubPassword = "admin1234";
  stubFailedLogins = 0;
  stubLocked = false;
}
resetUsers();

// 복잡도 정책 스텁 (TASK-0804) — 실제 API와 동일 메시지
function complexityError(password) {
  if ((password ?? "").length < 8) return "비밀번호는 최소 8자여야 합니다.";
  if (!/[a-zA-Z]/.test(password)) return "비밀번호에 영문자를 1자 이상 포함해 주세요.";
  if (!/[0-9]/.test(password)) return "비밀번호에 숫자를 1자 이상 포함해 주세요.";
  return null;
}

// 발행 파이프라인 스텁 상태 (TASK-0704) — /__mode 전환 시 초기화
let pubContent;
let pubHistory;
function resetPublishing() {
  pubContent = {
    id: "content-pub-1",
    projectId: "proj-pub",
    productObjectId: null,
    productObjectVersion: 3,
    title: "발행 테스트 상세페이지",
    body: "# 발행 테스트\n\n본문",
    status: "DRAFT",
    publishedAt: null,
    createdAt: "2026-07-28T09:00:00.000Z",
    updatedAt: "2026-07-28T09:00:00.000Z",
  };
  pubHistory = [];
}
resetPublishing();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 브라우저(3100)에서의 클라이언트 호출 허용 (실제 API도 CORS 허용)
  // credentials 포함 요청(TASK-0804)은 와일드카드 불가 — origin 반사
  res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/__mode") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      mode = JSON.parse(body).mode;
      lastUrls = [];
      resetPublishing();
      resetUsers();
      res.end(JSON.stringify({ mode }));
    });
    return;
  }

  // ── 사용자 관리 (TASK-0802) — stub-token(ADMIN)만 접근 가능 ──
  if (url.pathname.startsWith("/auth/users") || url.pathname === "/auth/audit") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "로그인이 필요합니다 (Authorization: Bearer <token>)." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && url.pathname === "/auth/users") {
      res.end(JSON.stringify({ users: stubUsers }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/auth/audit") {
      res.end(JSON.stringify({ audit: [...stubAudit].reverse() }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/users") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const data = JSON.parse(body);
        const user = {
          id: `u-${stubUsers.length + 1}`,
          email: data.email,
          name: data.name,
          role: data.role,
          disabled: false,
          lockedUntil: null,
          createdAt: new Date().toISOString(),
        };
        stubUsers.push(user);
        stubAudit.push({
          id: `a-${stubAudit.length + 1}`,
          actor: "admin@acos.local",
          action: "USER_CREATED",
          targetEmail: data.email,
          detail: `role=${data.role}`,
          createdAt: new Date().toISOString(),
        });
        res.statusCode = 201;
        res.end(JSON.stringify(user));
      });
      return;
    }
    // 비밀번호 재설정 (TASK-0803) — ADMIN 전용, 자기 자신 불가
    if (req.method === "POST" && url.pathname.endsWith("/password-reset")) {
      const id = url.pathname.split("/").at(-2);
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { newPassword } = JSON.parse(body);
        const user = stubUsers.find((item) => item.id === id);
        if (!user) {
          res.statusCode = 400;
          res.end(JSON.stringify({ message: "사용자를 찾을 수 없습니다." }));
          return;
        }
        if (user.email === "admin@acos.local") {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              message:
                "자기 자신은 비밀번호 변경(현재 비밀번호 확인)을 사용해 주세요.",
            }),
          );
          return;
        }
        const violation = complexityError(newPassword);
        if (violation) {
          res.statusCode = 400;
          res.end(JSON.stringify({ message: violation }));
          return;
        }
        stubAudit.push({
          id: `a-${stubAudit.length + 1}`,
          actor: "admin@acos.local",
          action: "PASSWORD_RESET",
          targetEmail: user.email,
          detail: null,
          createdAt: new Date().toISOString(),
        });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === "PATCH") {
      const id = url.pathname.split("/").pop();
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const data = JSON.parse(body);
        const user = stubUsers.find((item) => item.id === id);
        if (!user) {
          res.statusCode = 400;
          res.end(JSON.stringify({ message: "사용자를 찾을 수 없습니다." }));
          return;
        }
        if (user.email === "admin@acos.local") {
          res.statusCode = 400;
          res.end(
            JSON.stringify({ message: "자기 자신의 역할/활성 상태는 변경할 수 없습니다." }),
          );
          return;
        }
        if (data.role !== undefined) {
          stubAudit.push({
            id: `a-${stubAudit.length + 1}`,
            actor: "admin@acos.local",
            action: "ROLE_CHANGED",
            targetEmail: user.email,
            detail: `${user.role} → ${data.role}`,
            createdAt: new Date().toISOString(),
          });
          user.role = data.role;
        }
        if (data.disabled !== undefined) {
          stubAudit.push({
            id: `a-${stubAudit.length + 1}`,
            actor: "admin@acos.local",
            action: data.disabled ? "USER_DISABLED" : "USER_ENABLED",
            targetEmail: user.email,
            detail: null,
            createdAt: new Date().toISOString(),
          });
          user.disabled = data.disabled;
        }
        res.end(JSON.stringify(user));
      });
      return;
    }
  }

  // ── 비밀번호 변경 (TASK-0803) — 본인 셀프 서비스 ──
  if (req.method === "PATCH" && url.pathname === "/auth/password") {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = 401;
      res.end(JSON.stringify({ message: "로그인이 필요합니다 (Authorization: Bearer <token>)." }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { currentPassword, newPassword } = JSON.parse(body);
      if (currentPassword !== stubPassword) {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: "현재 비밀번호가 올바르지 않습니다." }));
        return;
      }
      const violation = complexityError(newPassword);
      if (violation) {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: violation }));
        return;
      }
      if (newPassword === currentPassword) {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: "새 비밀번호가 현재 비밀번호와 동일합니다." }));
        return;
      }
      stubPassword = newPassword;
      stubAudit.push({
        id: `a-${stubAudit.length + 1}`,
        actor: "admin@acos.local",
        action: "PASSWORD_CHANGED",
        targetEmail: "admin@acos.local",
        detail: null,
        createdAt: new Date().toISOString(),
      });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── 인증 (TASK-0801 · TASK-0804 잠금) ──
  if (req.method === "POST" && url.pathname === "/auth/login") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { email, password } = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      if (stubLocked) {
        res.statusCode = 401;
        res.end(
          JSON.stringify({
            message:
              "로그인 실패가 반복되어 계정이 잠겼습니다. 잠시 후 다시 시도해 주세요.",
          }),
        );
        return;
      }
      if (email === "admin@acos.local" && password === stubPassword) {
        stubFailedLogins = 0;
        res.end(
          JSON.stringify({
            token: "stub-token",
            expiresAt: "2027-01-01T00:00:00.000Z",
            user: {
              id: "u-1",
              email: "admin@acos.local",
              name: "관리자",
              role: "ADMIN",
              lockedUntil: null,
              createdAt: "2026-07-28T00:00:00.000Z",
            },
          }),
        );
      } else {
        if (email === "admin@acos.local") {
          stubFailedLogins += 1;
          stubAudit.push({
            id: `a-${stubAudit.length + 1}`,
            actor: email,
            action: "LOGIN_FAILED",
            targetEmail: email,
            detail: `잘못된 비밀번호 (${stubFailedLogins}/5)`,
            createdAt: new Date().toISOString(),
          });
          if (stubFailedLogins >= 5) {
            stubLocked = true;
            stubAudit.push({
              id: `a-${stubAudit.length + 1}`,
              actor: email,
              action: "ACCOUNT_LOCKED",
              targetEmail: email,
              detail: "연속 5회 실패 — 15분 잠금",
              createdAt: new Date().toISOString(),
            });
          }
        }
        res.statusCode = 401;
        res.end(
          JSON.stringify({ message: "이메일 또는 비밀번호가 올바르지 않습니다." }),
        );
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/auth/logout") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── 발행 파이프라인 (프로젝트 상세 화면용, mode 무관 동작) ──
  if (url.pathname === "/projects/proj-pub") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "proj-pub",
        name: "발행 테스트 프로젝트",
        description: null,
        createdAt: "2026-07-28T00:00:00.000Z",
        products: [],
        latestProductObjectVersion: 3,
      }),
    );
    return;
  }
  if (url.pathname === "/projects/proj-pub/product-object") {
    res.statusCode = 404;
    res.end("{}");
    return;
  }
  if (url.pathname === "/projects/proj-pub/contents") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ contents: [pubContent] }));
    return;
  }
  if (url.pathname === `/projects/proj-pub/contents/${pubContent.id}/history`) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ history: [...pubHistory].reverse() }));
    return;
  }
  if (
    req.method === "PATCH" &&
    url.pathname === `/projects/proj-pub/contents/${pubContent.id}/status`
  ) {
    // TASK-0801: 전이는 인증 필요 (EDITOR 이상)
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          message: "로그인이 필요합니다 (Authorization: Bearer <token>).",
        }),
      );
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { status } = JSON.parse(body);
      const now = new Date().toISOString();
      pubHistory.push({
        id: `hist-${pubHistory.length + 1}`,
        contentId: pubContent.id,
        fromStatus: pubContent.status,
        toStatus: status,
        createdAt: now,
      });
      pubContent.status = status;
      if (status === "PUBLISHED" && !pubContent.publishedAt) {
        pubContent.publishedAt = now;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(pubContent));
    });
    return;
  }
  if (url.pathname === "/__last") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ urls: lastUrls }));
    return;
  }

  lastUrls.push(req.url);
  if (mode === "error") {
    res.statusCode = 500;
    res.end("stub error");
    return;
  }
  res.setHeader("content-type", "application/json");

  // ── Provider Dashboard (TASK-0902) ──
  if (url.pathname === "/llm/providers") {
    res.end(
      JSON.stringify({
        selected: { provider: "mock", defaultModel: "mock-llm-1" },
        routing: {
          "content-generation": null,
          "product-analysis": mode === "data" ? "gpt-4o-mini" : null,
          "vision-analysis": null,
        },
        providers: [
          { name: "mock", title: "Mock", connection: "mock", keyConfigured: true, selected: true, defaultModel: "mock-llm-1", models: ["mock-llm-1"], note: "개발 기본 — 실제 API 미호출, 비용 0" },
          { name: "openai", title: "OpenAI", connection: "official", keyConfigured: mode === "data", selected: false, defaultModel: "gpt-4o", models: ["gpt-4o", "gpt-4o-mini"], note: "공식 연결" },
          { name: "anthropic", title: "Anthropic", connection: "official", keyConfigured: false, selected: false, defaultModel: "claude-opus-5", models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"], note: "공식 연결 (TASK-0903)" },
          { name: "gemini", title: "Google Gemini", connection: "official", keyConfigured: false, selected: false, defaultModel: "gemini-2.5-flash", models: ["gemini-2.5-flash"], note: "공식 연결 (TASK-0903)" },
        ],
      }),
    );
    return;
  }
  // ── Routing Dashboard (TASK-1001) ──
  if (url.pathname === "/llm/routing") {
    res.end(
      JSON.stringify({
        defaultProvider: "mock",
        availableProviders:
          mode === "data" ? ["mock", "openai", "anthropic"] : ["mock"],
        routes:
          mode === "data"
            ? [
                { feature: "content-generation", provider: "mock", model: null, source: "default", reason: null, env: "LLM_ROUTE_CONTENT" },
                { feature: "product-analysis", provider: "anthropic", model: "claude-sonnet-5", source: "feature", reason: null, env: "LLM_ROUTE_ANALYSIS" },
                { feature: "vision-analysis", provider: "mock", model: null, source: "fallback", reason: 'Provider "gemini"를 사용할 수 없어 기본 Provider로 처리했습니다 (API 키 미설정 등).', env: "LLM_ROUTE_VISION" },
              ]
            : [
                { feature: "content-generation", provider: "mock", model: null, source: "default", reason: null, env: "LLM_ROUTE_CONTENT" },
                { feature: "product-analysis", provider: "mock", model: null, source: "default", reason: null, env: "LLM_ROUTE_ANALYSIS" },
                { feature: "vision-analysis", provider: "mock", model: null, source: "default", reason: null, env: "LLM_ROUTE_VISION" },
              ],
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }
  // ── Routing Experiment (TASK-1003) ──
  if (url.pathname === "/llm/experiments") {
    res.end(
      JSON.stringify({
        availableProviders:
          mode === "data" ? ["mock", "openai", "anthropic"] : ["mock"],
        experiments:
          mode === "data"
            ? [
                {
                  feature: "product-analysis",
                  name: "sonnet-canary",
                  kind: "canary",
                  env: "LLM_EXPERIMENT_ANALYSIS",
                  active: true,
                  reason: null,
                  assignments: 100,
                  variants: [
                    { key: "openai:gpt-4o", provider: "openai", model: "gpt-4o", weight: 90, weightShare: 0.9, available: true, effectiveShare: 0.9, assignments: 91, actualShare: 0.91 },
                    { key: "anthropic:claude-sonnet-5", provider: "anthropic", model: "claude-sonnet-5", weight: 10, weightShare: 0.1, available: true, effectiveShare: 0.1, assignments: 9, actualShare: 0.09 },
                  ],
                },
                {
                  feature: "vision-analysis",
                  name: "vision-analysis",
                  kind: "ab",
                  env: "LLM_EXPERIMENT_VISION",
                  active: false,
                  reason:
                    "사용 가능한 변형이 없어 실험을 적용하지 않고 기존 라우팅으로 처리합니다 (API 키 미설정 등).",
                  assignments: 0,
                  variants: [
                    { key: "gemini", provider: "gemini", model: null, weight: 1, weightShare: 0.5, available: false, effectiveShare: 0, assignments: 0, actualShare: null },
                    { key: "cohere", provider: "cohere", model: null, weight: 1, weightShare: 0.5, available: false, effectiveShare: 0, assignments: 0, actualShare: null },
                  ],
                },
              ]
            : [],
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }
  // ── Provider Failover (TASK-1002) ──
  if (url.pathname === "/llm/failover") {
    const now = new Date().toISOString();
    res.end(
      JSON.stringify(
        mode === "data"
          ? {
              enabled: true,
              priority: ["openai", "anthropic", "mock"],
              timeoutMs: 120000,
              attemptsPerProvider: 3,
              health: [
                { provider: "mock", healthy: true, consecutiveFailures: 0, lastFailureAt: null, lastSuccessAt: now, cooldownUntil: null },
                { provider: "openai", healthy: false, consecutiveFailures: 3, lastFailureAt: now, lastSuccessAt: null, cooldownUntil: now },
                { provider: "anthropic", healthy: true, consecutiveFailures: 0, lastFailureAt: null, lastSuccessAt: now, cooldownUntil: null },
              ],
              metrics: {
                attempts: 12,
                failovers: 3,
                exhausted: 1,
                skipped: 2,
                byProvider: [
                  { provider: "openai", success: 4, failed: 3 },
                  { provider: "anthropic", success: 3, failed: 0 },
                  { provider: "mock", success: 2, failed: 0 },
                ],
                healthChecks: { ok: 4, failed: 1 },
                since: now,
              },
              checkedAt: now,
            }
          : {
              enabled: false,
              priority: [],
              timeoutMs: 120000,
              attemptsPerProvider: 3,
              health: [
                { provider: "mock", healthy: true, consecutiveFailures: 0, lastFailureAt: null, lastSuccessAt: null, cooldownUntil: null },
              ],
              metrics: {
                attempts: 0,
                failovers: 0,
                exhausted: 0,
                skipped: 0,
                byProvider: [],
                healthChecks: { ok: 0, failed: 0 },
                since: now,
              },
              checkedAt: now,
            },
      ),
    );
    return;
  }
  if (url.pathname === "/llm/budget") {
    res.end(
      JSON.stringify(
        mode === "data"
          ? {
              daily: { budget: 10, spend: 8.52, ratio: 0.852, status: "alert" },
              monthly: { budget: 100, spend: 42.1, ratio: 0.421, status: "ok" },
              alertRatio: 0.8,
              checkedAt: new Date().toISOString(),
            }
          : {
              daily: { budget: null, spend: 0, ratio: null, status: "off" },
              monthly: { budget: null, spend: 0, ratio: null, status: "off" },
              alertRatio: 0.8,
              checkedAt: new Date().toISOString(),
            },
      ),
    );
    return;
  }

  if (url.pathname === "/executions/stats") {
    res.end(
      JSON.stringify(
        mode === "empty"
          ? stats(EMPTY_TOTALS, [])
          : stats(DATA_TOTALS, [
              { key: "content-generation", stats: DATA_TOTALS },
            ]),
      ),
    );
    return;
  }
  if (url.pathname === "/executions/timeline") {
    res.end(
      JSON.stringify({
        interval: url.searchParams.get("interval") ?? "day",
        range: { from: null, to: null },
        filter: { feature: null, provider: null, model: null },
        buckets:
          mode === "empty"
            ? []
            : [
                {
                  bucketStart: "2026-07-28T09:00:00.000Z",
                  stats: DATA_TOTALS,
                },
              ],
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`stub api on :${PORT}`);
});

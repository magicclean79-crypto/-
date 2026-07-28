// 스텁 Execution API (TASK-0702) — 웹 스모크 테스트 전용.
// POST /__mode { mode: "data" | "empty" | "error" } 로 응답 상태를 전환하고,
// GET /__last 로 마지막 수신 쿼리를 확인한다 (필터 전달 검증용).
import http from "node:http";

const PORT = 4999;
let mode = "data";
let lastUrls = [];
// 실험 운영 상태 스텁 (TASK-1101) — 전이 후 응답에 반영된다
let stubLifecycle = null;
// 관리 콘솔 스텁 상태 (TASK-1201)
let stubSettings = {};
let stubAdminAudit = [];

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
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
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
      stubLifecycle = null;
      stubSettings = {};
      stubAdminAudit = [];
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
  // ── Production Readiness (TASK-1202) ── ADMIN 전용
  if (url.pathname === "/health/ready") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    const ready = mode === "data";
    res.end(
      JSON.stringify({
        ready,
        production: !ready,
        nodeEnv: ready ? "development" : "production",
        environment: ready
          ? { ok: true, errors: [], warnings: [], checked: 22 }
          : {
              ok: false,
              errors: [
                { name: "S3_BUCKET", severity: "error", message: "필수 환경변수가 없습니다 — 이미지 버킷 이름.", category: "storage" },
              ],
              warnings: [
                { name: "LLM_DAILY_BUDGET_USD", severity: "warning", message: "운영 일 예산이 설정되지 않았습니다 — 비용 폭주를 막을 상한이 없습니다.", category: "llm" },
              ],
              checked: 22,
            },
        components: [
          { name: "database", ok: true, detail: "연결 정상", latencyMs: 3 },
          { name: "storage", ok: ready, detail: ready ? "버킷 접근 정상 (acos)" : "접근 실패: 버킷을 찾을 수 없습니다", latencyMs: 12 },
        ],
        pendingMigrations: ready ? 0 : 2,
        providers: { available: ready ? ["mock", "openai"] : ["mock"], default: "mock" },
        checklist: ready
          ? [
              { id: "env", title: "환경변수 검증", status: "pass", detail: "22개 항목 이상 없음.", blocking: true },
              { id: "database", title: "데이터베이스 연결", status: "pass", detail: "연결 정상", blocking: true },
              { id: "migrations", title: "마이그레이션 적용", status: "pass", detail: "미적용 마이그레이션 없음.", blocking: true },
              { id: "storage", title: "이미지 저장소 접근", status: "pass", detail: "버킷 접근 정상 (acos)", blocking: true },
              { id: "admin-user", title: "관리자 계정", status: "pass", detail: "ADMIN 계정이 존재합니다.", blocking: true },
              { id: "provider", title: "실제 Provider 연결", status: "pass", detail: "사용 가능: openai (기본 mock)", blocking: false },
              { id: "smoke", title: "실 Provider 스모크 (배포 직후 1회)", status: "manual", detail: "node scripts/real-provider-smoke.mjs 실행", blocking: false },
            ]
          : [
              { id: "env", title: "환경변수 검증", status: "fail", detail: "필수/형식 오류 1건 — S3_BUCKET", blocking: true },
              { id: "database", title: "데이터베이스 연결", status: "pass", detail: "연결 정상", blocking: true },
              { id: "migrations", title: "마이그레이션 적용", status: "fail", detail: "미적용 마이그레이션 2건 — 배포 전에 적용하세요.", blocking: true },
              { id: "storage", title: "이미지 저장소 접근", status: "fail", detail: "접근 실패: 버킷을 찾을 수 없습니다", blocking: true },
              { id: "provider", title: "실제 Provider 연결", status: "fail", detail: "mock만 사용 가능합니다 — 운영에서는 실제 Provider 키가 필요합니다.", blocking: true },
              { id: "budget", title: "비용 예산 설정", status: "warn", detail: "예산이 없습니다 — 비용 폭주를 막을 상한이 없습니다.", blocking: false },
              { id: "smoke", title: "실 Provider 스모크 (배포 직후 1회)", status: "manual", detail: "node scripts/real-provider-smoke.mjs 실행", blocking: false },
            ],
        summary: ready
          ? { ready: true, pass: 6, fail: 0, warn: 0, manual: 1, blockers: [] }
          : {
              ready: false,
              pass: 1,
              fail: 4,
              warn: 1,
              manual: 1,
              blockers: [
                { id: "env", title: "환경변수 검증", status: "fail", detail: "필수/형식 오류 1건 — S3_BUCKET", blocking: true },
                { id: "migrations", title: "마이그레이션 적용", status: "fail", detail: "미적용 마이그레이션 2건 — 배포 전에 적용하세요.", blocking: true },
                { id: "storage", title: "이미지 저장소 접근", status: "fail", detail: "접근 실패: 버킷을 찾을 수 없습니다", blocking: true },
                { id: "provider", title: "실제 Provider 연결", status: "fail", detail: "mock만 사용 가능합니다 — 운영에서는 실제 Provider 키가 필요합니다.", blocking: true },
              ],
            },
        configuration: [
          { name: "DATABASE_URL", category: "database", description: "PostgreSQL 연결 문자열", requiredInProduction: true, configured: true, value: null, secret: true, fallback: null },
          { name: "S3_BUCKET", category: "storage", description: "이미지 버킷 이름", requiredInProduction: true, configured: ready, value: ready ? "acos" : null, secret: false, fallback: null },
          { name: "LLM_PROVIDER", category: "llm", description: "기본 LLM Provider", requiredInProduction: false, configured: false, value: null, secret: false, fallback: "mock (실제 호출 없음)" },
        ],
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }
  // ── Real Provider 운영 점검 (TASK-1301) ── ADMIN 전용
  if (
    url.pathname === "/llm/providers/validate" ||
    url.pathname === "/llm/cost-verification" ||
    url.pathname === "/llm/monitoring"
  ) {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    const healthy = mode === "data";

    if (url.pathname === "/llm/providers/validate") {
      const live = url.searchParams.get("live") === "1";
      res.end(
        JSON.stringify({
          ok: healthy,
          production: !healthy,
          liveChecked: live,
          providers: [
            {
              provider: "openai",
              title: "OpenAI",
              keyEnv: "OPENAI_API_KEY",
              format: healthy ? "ok" : "placeholder",
              message: healthy
                ? "형식은 정상입니다 — 유효한 키인지는 Live Check로만 확인할 수 있습니다."
                : "플레이스홀더 값으로 보입니다 — 실제 키로 교체하세요.",
              hint: "sk-pro…",
              length: 51,
              required: true,
              instantiated: healthy,
              defaultModel: "gpt-4o",
              live: live
                ? {
                    provider: "openai",
                    model: "gpt-4o",
                    status: healthy ? "ok" : "error",
                    latencyMs: 412,
                    error: healthy ? null : "401 Incorrect API key provided",
                    checkedAt: new Date().toISOString(),
                  }
                : null,
            },
            {
              provider: "anthropic",
              title: "Anthropic Claude",
              keyEnv: "ANTHROPIC_API_KEY",
              format: "missing",
              message: "ANTHROPIC_API_KEY가 설정되지 않았습니다.",
              hint: null,
              length: null,
              required: false,
              instantiated: false,
              defaultModel: "claude-sonnet-5",
              live: null,
            },
          ],
          blockers: healthy
            ? []
            : ["openai: 플레이스홀더 값으로 보입니다 — 실제 키로 교체하세요."],
          checkedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname === "/llm/cost-verification") {
      res.end(
        JSON.stringify({
          ok: healthy,
          hours: Number(url.searchParams.get("hours")) || 24,
          checked: healthy ? 42 : 12,
          unpricedCalls: healthy ? 0 : 12,
          recordedTotal: healthy ? 0.184213 : 0,
          expectedTotal: healthy ? 0.184213 : 0,
          issues: healthy
            ? []
            : [
                {
                  kind: "unpriced",
                  provider: "openai",
                  model: "gpt-5-preview",
                  count: 12,
                  message:
                    "가격표에 없는 모델입니다 — 비용이 집계되지 않아 **예산 상한이 적용되지 않습니다**.",
                  sampleIds: ["exec-1", "exec-2", "exec-3"],
                },
              ],
          pricing: [
            { model: "gpt-4o", inputPerMillion: 2.5, outputPerMillion: 10 },
            { model: "claude-sonnet-5", inputPerMillion: 3, outputPerMillion: 15 },
          ],
          checkedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    res.end(
      JSON.stringify({
        status: healthy ? "healthy" : "degraded",
        windowMinutes: Number(url.searchParams.get("minutes")) || 60,
        minSamples: 5,
        totals: {
          calls: healthy ? 40 : 10,
          successCount: healthy ? 40 : 7,
          failedCount: healthy ? 0 : 3,
          successRate: healthy ? 1 : 0.7,
          cost: healthy ? 0.184213 : null,
          unpricedCalls: healthy ? 0 : 7,
        },
        providers: [
          {
            provider: "openai",
            calls: healthy ? 40 : 10,
            successCount: healthy ? 40 : 7,
            failedCount: healthy ? 0 : 3,
            successRate: healthy ? 1 : 0.7,
            latency: { p50: 820, p95: 1900, p99: 2400, max: 2400 },
            cost: healthy ? 0.184213 : null,
            costPerCall: healthy ? 0.004605 : null,
            unpricedCalls: healthy ? 0 : 7,
            models: ["gpt-4o"],
            lastCallAt: new Date().toISOString(),
            status: healthy ? "healthy" : "degraded",
          },
        ],
        alerts: healthy
          ? []
          : [
              {
                level: "warning",
                provider: "openai",
                message:
                  "성공률 70% (7/10) — 기준 95% 미만입니다. Failover 우선순위를 점검하세요.",
              },
            ],
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }
  // ── Provider Administration Console (TASK-1201) ── ADMIN 전용
  if (url.pathname === "/admin/console" || url.pathname === "/admin/audit" ||
      url.pathname.startsWith("/admin/settings/")) {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    if (req.method === "PUT" && url.pathname.startsWith("/admin/settings/")) {
      const key = decodeURIComponent(url.pathname.slice("/admin/settings/".length));
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { value } = body ? JSON.parse(body) : { value: null };
        // 검증 스텁 — 실제 API와 같은 메시지로 400을 재현한다
        if (key === "budget.daily" && value !== null && Number(value) <= 0) {
          res.statusCode = 400;
          res.end(JSON.stringify({ message: "예산 값은 0보다 큰 숫자여야 합니다." }));
          return;
        }
        const before = stubSettings[key] ?? null;
        if (value === null) delete stubSettings[key];
        else stubSettings[key] = value;
        stubAdminAudit.unshift({
          id: `s-${stubAdminAudit.length + 1}`,
          actor: "admin@acos.local",
          action: value === null ? "SETTING_CLEARED" : "SETTING_UPDATED",
          key,
          before,
          after: value,
          note: null,
          createdAt: new Date().toISOString(),
        });
        res.end(JSON.stringify({ key, value, updatedAt: new Date().toISOString() }));
      });
      return;
    }
    if (url.pathname === "/admin/audit") {
      res.end(JSON.stringify(stubAdminAudit));
      return;
    }
    const setting = (key, envName, envValue, defaultValue = null) => {
      const override = stubSettings[key] ?? null;
      if (override !== null) {
        return { key, value: override, source: "override", fallback: envValue ?? defaultValue, env: envName };
      }
      if (envValue !== null && envValue !== undefined) {
        return { key, value: envValue, source: "env", fallback: defaultValue, env: envName };
      }
      return { key, value: defaultValue, source: "default", fallback: null, env: envName };
    };
    res.end(
      JSON.stringify({
        providers: [
          { name: "mock", title: "Mock", connection: "mock", defaultModel: "mock-llm-1", models: ["mock-llm-1"], keyConfigured: true, enabled: stubSettings["provider.mock.enabled"] !== "false", available: true, setting: setting("provider.mock.enabled", null, null, "true") },
          { name: "openai", title: "OpenAI", connection: "official", defaultModel: "gpt-4o", models: ["gpt-4o", "gpt-4o-mini"], keyConfigured: true, enabled: stubSettings["provider.openai.enabled"] !== "false", available: stubSettings["provider.openai.enabled"] !== "false", setting: setting("provider.openai.enabled", "OPENAI_API_KEY", null, "true") },
          { name: "anthropic", title: "Anthropic", connection: "official", defaultModel: "claude-opus-5", models: ["claude-opus-5"], keyConfigured: false, enabled: true, available: false, setting: setting("provider.anthropic.enabled", "ANTHROPIC_API_KEY", null, "true") },
        ],
        models: [
          { feature: "content-generation", setting: setting("model.content-generation", "LLM_MODEL_CONTENT", null), effective: null },
          { feature: "product-analysis", setting: setting("model.product-analysis", "LLM_MODEL_ANALYSIS", "gpt-4o-mini"), effective: stubSettings["model.product-analysis"] ?? "gpt-4o-mini" },
          { feature: "vision-analysis", setting: setting("model.vision-analysis", "LLM_MODEL_VISION", null), effective: null },
        ],
        budget: {
          daily: setting("budget.daily", "LLM_DAILY_BUDGET_USD", "10"),
          monthly: setting("budget.monthly", "LLM_MONTHLY_BUDGET_USD", null),
          alertRatio: setting("budget.alertRatio", "LLM_BUDGET_ALERT_RATIO", null, "0.8"),
          status: {
            daily: { budget: Number(stubSettings["budget.daily"] ?? 10), spend: 8.52, ratio: 0.852, status: "alert" },
            monthly: { budget: null, spend: 42.1, ratio: null, status: "off" },
            alertRatio: 0.8,
            checkedAt: new Date().toISOString(),
          },
        },
        experiments: [
          { feature: "content-generation", setting: setting("experiment.content-generation", "LLM_EXPERIMENT_CONTENT", null) },
          { feature: "product-analysis", setting: setting("experiment.product-analysis", "LLM_EXPERIMENT_ANALYSIS", "openai=90,anthropic=10") },
          { feature: "vision-analysis", setting: setting("experiment.vision-analysis", "LLM_EXPERIMENT_VISION", null) },
        ],
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }
  // ── Experiment Analytics (TASK-1102) ──
  const analytics = url.pathname.match(
    /^\/llm\/experiments\/([^/]+)\/analytics$/,
  );
  if (analytics) {
    const feature = analytics[1];
    res.end(
      JSON.stringify(
        mode === "data"
          ? {
              feature,
              name: "sonnet-canary",
              configured: true,
              status: "RUNNING",
              promotedVariant: null,
              since: "2026-07-28T09:00:00.000Z",
              totalCalls: 1000,
              baseline: "openai:gpt-4o",
              variants: [
                { key: "openai:gpt-4o", provider: "openai", model: "gpt-4o", weightShare: 0.9, calls: 500, successes: 450, failures: 50, successRate: 0.9, successRateLow: 0.87, successRateHigh: 0.92, avgLatencyMs: 900, cost: 9, costPerCall: 0.018, inputTokens: 50000, outputTokens: 15000 },
                { key: "anthropic:claude-sonnet-5", provider: "anthropic", model: "claude-sonnet-5", weightShare: 0.1, calls: 500, successes: 495, failures: 5, successRate: 0.99, successRateLow: 0.97, successRateHigh: 0.99, avgLatencyMs: 500, cost: 4.5, costPerCall: 0.009, inputTokens: 50000, outputTokens: 15000 },
              ],
              comparisons: [
                { key: "anthropic:claude-sonnet-5", successRateDelta: 0.09, latencyDelta: -400, costPerCallDelta: -0.009, successRateConfidence: 0.999 },
              ],
              recommendation: {
                winner: "anthropic:claude-sonnet-5",
                basis: "success-rate",
                confidence: 0.999,
                reason:
                  "성공률이 anthropic:claude-sonnet-5 99.0% vs openai:gpt-4o 90.0%로, 이 차이가 우연일 가능성은 낮습니다 (신뢰도 99.9%).",
                conclusive: true,
              },
              checkedAt: new Date().toISOString(),
            }
          : {
              feature,
              name: feature,
              configured: false,
              status: "RUNNING",
              promotedVariant: null,
              since: null,
              totalCalls: 0,
              baseline: null,
              variants: [],
              comparisons: [],
              recommendation: {
                winner: null,
                basis: "no-variants",
                confidence: 0,
                reason: "비교할 변형이 없습니다.",
                conclusive: false,
              },
              checkedAt: new Date().toISOString(),
            },
      ),
    );
    return;
  }
  // ── Experiment Lifecycle & Sticky Assignment (TASK-1101) ──
  if (url.pathname === "/llm/experiments/assignments") {
    res.end(
      JSON.stringify(
        mode === "data"
          ? {
              assignments: [
                { feature: "product-analysis", projectId: "proj-a", projectName: "여름 신상", variantKey: "openai:gpt-4o", signature: "openai:gpt-4o=90,anthropic:claude-sonnet-5=10", assignedAt: "2026-07-28T10:00:00.000Z", updatedAt: "2026-07-28T10:00:00.000Z" },
                { feature: "product-analysis", projectId: "proj-b", projectName: "겨울 기획", variantKey: "anthropic:claude-sonnet-5", signature: "openai:gpt-4o=90,anthropic:claude-sonnet-5=10", assignedAt: "2026-07-28T11:00:00.000Z", updatedAt: "2026-07-28T11:00:00.000Z" },
              ],
              distribution: [],
              reassignments: [
                { feature: "product-analysis", projectId: "proj-b", reason: "DEFINITION_CHANGED", fromVariant: "openai:gpt-4o", toVariant: "anthropic:claude-sonnet-5", fromSignature: "openai:gpt-4o=95,anthropic:claude-sonnet-5=5", toSignature: "openai:gpt-4o=90,anthropic:claude-sonnet-5=10", createdAt: "2026-07-28T11:00:00.000Z" },
              ],
            }
          : { assignments: [], distribution: [], reassignments: [] },
      ),
    );
    return;
  }
  // 상태 전이 (START / STOP / PROMOTE / ROLLBACK) — 인증 필요
  const transition = url.pathname.match(
    /^\/llm\/experiments\/([^/]+)\/(start|stop|promote|rollback)$/,
  );
  if (req.method === "POST" && transition) {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = 401;
      res.end(JSON.stringify({ message: "로그인이 필요합니다." }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      const action = transition[2].toUpperCase();
      stubLifecycle = {
        feature: transition[1],
        status:
          action === "STOP"
            ? "STOPPED"
            : action === "PROMOTE"
              ? "PROMOTED"
              : "RUNNING",
        promotedVariant: action === "PROMOTE" ? parsed.variantKey ?? null : null,
        actor: "admin@acos.local",
        note: null,
        assignmentCount: 2,
        updatedAt: new Date().toISOString(),
        events: [
          {
            id: "ev-1",
            action,
            fromStatus: "RUNNING",
            toStatus:
              action === "STOP"
                ? "STOPPED"
                : action === "PROMOTE"
                  ? "PROMOTED"
                  : "RUNNING",
            fromVariant: null,
            toVariant: action === "PROMOTE" ? parsed.variantKey ?? null : null,
            actor: "admin@acos.local",
            note: null,
            createdAt: new Date().toISOString(),
          },
        ],
      };
      res.end(JSON.stringify(stubLifecycle));
    });
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
                  lifecycle: stubLifecycle ?? {
                    feature: "product-analysis",
                    status: "RUNNING",
                    promotedVariant: null,
                    actor: null,
                    note: null,
                    assignmentCount: 2,
                    updatedAt: null,
                    events: [],
                  },
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
                  lifecycle: {
                    feature: "vision-analysis",
                    status: "RUNNING",
                    promotedVariant: null,
                    actor: null,
                    note: null,
                    assignmentCount: 0,
                    updatedAt: null,
                    events: [],
                  },
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

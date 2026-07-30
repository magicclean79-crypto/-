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
// 운영 자동화 스텁 상태 (TASK-1302)
let stubChecksRan = false;
let stubArchived = 0;
let stubQueueDrained = false;
let stubDeadRequeued = false;
// 운영 검증 스텁 상태 (TASK-1601)
let stubBackupRan = false;
let stubRestoreVerified = false;
// 복구 리허설 스텁 상태 (TASK-1801)
let stubDrills = [];
let stubRequirements = [];
// 백업 무결성 스텁 상태 (TASK-2001)
let stubRemoteVerified = false;

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
let pubGovernanceBlocked;
let pubGovernanceRecords;
let pubScanRuns;

/**
 * 발행 거버넌스 판정 (TASK-2501).
 *
 * 차단 상태와 통과 상태를 같은 경로에서 만들 수 있어야 한다 — 통과만 보여
 * 주면 "막힌 화면"이 검증되지 않는다.
 */
function pubGovernanceVerdict() {
  const banned = {
    key: "banned-words",
    name: "금지어 검사",
    status: pubGovernanceBlocked ? "FAIL" : "PASS",
    blocking: true,
    messages: pubGovernanceBlocked
      ? ["금지어 발견: 1위 (제목 0건 · 본문 1건)"]
      : ["금지어 2개 기준 위반 없음"],
  };
  const checks = [
    {
      key: "content-body",
      name: "제목·본문",
      status: "PASS",
      blocking: true,
      messages: ["제목 12자 · 본문 20자"],
    },
    banned,
    {
      key: "disclosures",
      name: "필수 고지",
      status: "PASS",
      blocking: true,
      messages: ["적용 고지 1건 모두 본문에 있습니다."],
    },
    {
      key: "source-object",
      name: "근거 상품 연결",
      status: "WARNING",
      blocking: false,
      messages: [
        "연결된 Product Object가 없습니다 — 발행 후 이 콘텐츠의 근거를 추적할 수 없습니다.",
      ],
    },
    {
      key: "related-rules",
      name: "관련 규칙 검토",
      status: "PASS",
      blocking: false,
      messages: ["관련 RULE/LEGAL 지식 없음"],
    },
  ];
  const blockers = checks.filter(
    (check) => check.blocking && check.status === "FAIL",
  );
  return {
    projectId: "proj-pub",
    contentId: pubContent.id,
    contentStatus: pubContent.status,
    status: blockers.length > 0 ? "FAIL" : "WARNING",
    checks,
    blockers,
    publishable: blockers.length === 0,
    appliedRules: { bannedWordCount: 2, disclosureIds: ["wash"] },
    evaluatedAt: new Date().toISOString(),
  };
}

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
    // 마지막 발행 시각 (TASK-2801, CTO 결정 2701-②) — 발행할 때마다 갱신된다
    lastPublishedAt: null,
    createdAt: "2026-07-28T09:00:00.000Z",
    updatedAt: "2026-07-28T09:00:00.000Z",
  };
  pubHistory = [];
  // 발행 거버넌스 판정 (TASK-2501) — 기본은 통과. 차단 상태는 테스트가
  // POST /__publishing/ban 으로 만든다 (막힌 화면도 검증되어야 한다)
  pubGovernanceBlocked = false;
  pubGovernanceRecords = [];
  // 예약 스캔 이력 (TASK-2701) — 기준선 → 늘었음 두 건을 둔다
  pubScanRuns = [
    {
      id: "scan-2",
      scope: "project:proj-pub",
      summary: {
        scanned: 1,
        blocked: 1,
        publishedViolations: 0,
        warned: 0,
        clean: 0,
        byCheck: [{ key: "banned-words", blocked: 1, warned: 0 }],
      },
      verdict: "increased",
      previousTotal: 0,
      total: 1,
      alerted: true,
      trigger: "schedule",
      // 새로 위반된 콘텐츠 (TASK-2801, CTO 결정 2701-⑤)
      newlyCount: 1,
      newly: [
        {
          contentId: "content-pub-1",
          title: "발행 테스트 상세페이지",
          contentStatus: "REVIEW",
        },
      ],
      resolvedCount: 0,
      detail:
        "콘텐츠 1건 검사 · 위반 1건 — 지난번 0건보다 1건 늘어 경보했습니다." +
        " 새로 위반된 콘텐츠 1건.",
      createdAt: "2026-07-30T03:50:00.000Z",
    },
    {
      id: "scan-1",
      scope: "project:proj-pub",
      summary: {
        scanned: 1,
        blocked: 0,
        publishedViolations: 0,
        warned: 1,
        clean: 0,
        byCheck: [],
      },
      verdict: "baseline",
      previousTotal: null,
      total: 0,
      alerted: false,
      trigger: "schedule",
      // 첫 스캔은 비교할 지난 목록이 없다 — null은 "가릴 수 없었다"이고
      // 0("새로 생긴 것 없음")과 다르다
      newlyCount: null,
      newly: [],
      resolvedCount: null,
      detail:
        "콘텐츠 1건 검사 · 위반 0건 — 첫 스캔이므로 기준선으로 삼고 경보하지 않았습니다.",
      createdAt: "2026-07-29T03:50:00.000Z",
    },
  ];
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
      stubChecksRan = false;
      stubArchived = 0;
      stubQueueDrained = false;
      stubDeadRequeued = false;
      stubBackupRan = false;
      stubRestoreVerified = false;
      stubDrills = [];
      stubRequirements = [];
      stubRemoteVerified = false;
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
  // 발행 위반 스캔 (TASK-2601) — 상태를 바꾸지 않는 조회
  // 예약 스캔 이력 (TASK-2701) — 경보를 만들지 않은 실행도 남는다
  if (url.pathname === "/projects/proj-pub/governance/scans") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ runs: pubScanRuns }));
    return;
  }
  if (url.pathname === "/projects/proj-pub/governance/preflight") {
    const verdict = pubGovernanceVerdict();
    const released = pubContent.status === "PUBLISHED";
    const blockedBy = verdict.blockers.map((check) => check.key);
    const warnings = verdict.checks
      .filter((check) => check.status === "WARNING")
      .map((check) => check.key);
    const violating = blockedBy.length > 0 || warnings.length > 0;
    const items = violating
      ? [
          {
            contentId: pubContent.id,
            projectId: "proj-pub",
            title: pubContent.title,
            contentStatus: pubContent.status,
            status: verdict.status,
            blockedBy,
            warnings,
          },
        ]
      : [];
    const byCheck = [
      ...blockedBy.map((key) => ({ key, blocked: 1, warned: 0 })),
      ...warnings.map((key) => ({ key, blocked: 0, warned: 1 })),
    ];
    const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
    const shown = offset > 0 ? [] : items;
    const blocked = blockedBy.length > 0 && !released ? 1 : 0;
    const publishedViolations = blockedBy.length > 0 && released ? 1 : 0;
    const warned = blockedBy.length === 0 && warnings.length > 0 ? 1 : 0;
    const parts = [];
    if (publishedViolations > 0) {
      parts.push(
        `이미 발행된 위반 ${publishedViolations}건 (막을 수 없습니다 — 내려야 합니다)`,
      );
    }
    if (blocked > 0) parts.push(`발행이 막힐 것 ${blocked}건`);
    if (warned > 0) parts.push(`주의 ${warned}건`);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        projectId: "proj-pub",
        summary: {
          scanned: 1,
          blocked,
          publishedViolations,
          warned,
          clean: violating ? 0 : 1,
          byCheck,
        },
        items: shown,
        page: {
          offset: Math.min(offset, items.length),
          limit: Number(url.searchParams.get("limit") ?? 10) || 10,
          total: items.length,
          hasMore: false,
        },
        truncated: shown.length < items.length,
        omitted: items.length - shown.length,
        detail:
          parts.length === 0
            ? "콘텐츠 1건 검사 — 위반 없음."
            : `콘텐츠 1건 검사 — ${parts.join(" · ")}.` +
              " 이 스캔은 상태를 바꾸지 않고 고치지도 않습니다.",
        scannedAt: new Date().toISOString(),
      }),
    );
    return;
  }
  if (
    url.pathname === `/projects/proj-pub/contents/${pubContent.id}/governance`
  ) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(pubGovernanceVerdict()));
    return;
  }
  if (
    url.pathname ===
    `/projects/proj-pub/contents/${pubContent.id}/governance/history`
  ) {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ records: [...pubGovernanceRecords].reverse() }),
    );
    return;
  }
  // 본문의 금지어 유무를 전환한다 — 막힌 화면과 풀린 화면을 같은 경로로 본다
  if (req.method === "POST" && url.pathname === "/__publishing/ban") {
    pubGovernanceBlocked = true;
    pubContent.body = "# 발행 테스트\n\n업계 1위 제품입니다.";
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ blocked: pubGovernanceBlocked }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/__publishing/unban") {
    pubGovernanceBlocked = false;
    pubContent.body = "# 발행 테스트\n\n깨끗한 본문";
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ blocked: pubGovernanceBlocked }));
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
      // 발행 거버넌스 게이트 (TASK-2501) — 발행에만 적용된다
      if (status === "PUBLISHED") {
        const verdict = pubGovernanceVerdict();
        pubGovernanceRecords.push({
          id: `gov-${pubGovernanceRecords.length + 1}`,
          contentId: pubContent.id,
          status: verdict.status,
          published: verdict.publishable,
          blockedBy: verdict.blockers.map((check) => check.key),
          checks: verdict.checks,
          appliedRules: verdict.appliedRules,
          actor: "admin@acos.local",
          createdAt: now,
        });
        if (!verdict.publishable) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              message:
                "발행 거버넌스 판정을 통과하지 못했습니다 — " +
                verdict.blockers
                  .map((check) => `${check.name}: ${check.messages.join(" ")}`)
                  .join(" / "),
            }),
          );
          return;
        }
      }
      pubHistory.push({
        id: `hist-${pubHistory.length + 1}`,
        contentId: pubContent.id,
        fromStatus: pubContent.status,
        toStatus: status,
        createdAt: now,
      });
      pubContent.status = status;
      if (status === "PUBLISHED") {
        // 최초 발행 시각은 보존하고(TASK-0703 승인 ②) 마지막 발행 시각만
        // 갱신한다 (TASK-2801, CTO 결정 2701-②)
        if (!pubContent.publishedAt) {
          pubContent.publishedAt = now;
        }
        pubContent.lastPublishedAt = now;
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
    /**
     * 운영 준수 상태 (TASK-2401, CTO 결정 2301-①·③·④).
     *
     * S3 전환이 끝난 운영에서 **조회 실패가 실패로 승격된** 상태와, 스키마
     * 적용 상태·복구 판정을 **확인하지 못한** 상태를 함께 보여준다 — 화면이
     * 이 셋을 0이나 통과로 뭉개지 않는지가 요지다.
     */
    if (mode === "compliance") {
      const versioning = {
        id: "versioning",
        title: "이미지 버킷 버전 관리",
        status: "fail",
        detail:
          "버전 관리 상태를 읽지 못했습니다 — Amazon S3는 조회를 지원하므로 이것은 저장소의 한계가 아니라 s3:GetBucketVersioning 권한이 빠졌다는 뜻입니다 (CTO 결정 2301-③).",
        blocking: true,
      };
      const checklist = [
        { id: "env", title: "환경변수 검증", status: "pass", detail: "22개 항목 이상 없음.", blocking: true },
        { id: "database", title: "데이터베이스 연결", status: "pass", detail: "연결 정상", blocking: true },
        {
          id: "migrations",
          title: "마이그레이션 적용 (운영 담당자 수행)",
          status: "manual",
          detail:
            "스키마 적용 상태를 확인하지 못했습니다 — 마이그레이션 목록과 적용 기록을 모두 읽어야 판정할 수 있습니다. 직접 확인하세요.",
          blocking: true,
        },
        { id: "storage", title: "이미지 저장소 접근", status: "pass", detail: "버킷 접근 정상 (acos)", blocking: true },
        { id: "admin-user", title: "관리자 계정", status: "pass", detail: "ADMIN 계정이 존재합니다.", blocking: true },
        { id: "bucket", title: "이미지 버킷 준비", status: "pass", detail: "acos 확인됨.", blocking: true },
        {
          id: "iam",
          title: "저장소 접근 권한 (IAM)",
          status: "warn",
          detail:
            "버킷 보호 상태를 읽지 못했습니다 — s3:GetBucketVersioning · s3:GetReplicationConfiguration 권한을 확인하세요. 저장소가 S3인 것과 상태를 읽을 수 있는 것은 다릅니다.",
          blocking: false,
        },
        versioning,
        { id: "backup-bucket", title: "백업 버킷 준비·분리", status: "manual", detail: "acos-backups 분리됨 — 버전 관리 상태는 직접 확인하세요.", blocking: true },
        {
          id: "readiness",
          title: "재해 복구 판정 (복구 가능 여부)",
          status: "manual",
          detail: "재해 복구 판정을 확인하지 못했습니다 — /ops/readiness를 직접 확인하세요.",
          blocking: true,
        },
        { id: "smoke", title: "실 Provider 스모크 (배포 직후 1회)", status: "manual", detail: "node scripts/real-provider-smoke.mjs 실행", blocking: false },
      ];
      res.end(
        JSON.stringify({
          ready: false,
          production: true,
          nodeEnv: "production",
          environment: { ok: true, errors: [], warnings: [], checked: 22 },
          components: [
            { name: "database", ok: true, detail: "연결 정상", latencyMs: 3 },
            { name: "storage", ok: true, detail: "버킷 접근 정상 (acos)", latencyMs: 12 },
          ],
          // 확인하지 못한 것을 0으로 적지 않는다 (CTO 결정 2301-④)
          pendingMigrations: null,
          migrations: {
            status: "manual",
            detail:
              "스키마 적용 상태를 확인하지 못했습니다 — 마이그레이션 목록과 적용 기록을 모두 읽어야 판정할 수 있습니다. 직접 확인하세요.",
            pending: [],
            unknown: [],
            appliedBy: "operator",
          },
          providers: { available: ["mock", "openai"], default: "openai" },
          checklist,
          summary: {
            ready: false,
            pass: 5,
            fail: 1,
            warn: 1,
            manual: 4,
            blockers: [versioning],
          },
          configuration: [
            { name: "DATABASE_URL", category: "database", description: "PostgreSQL 연결 문자열", requiredInProduction: true, configured: true, value: null, secret: true, fallback: null },
            { name: "S3_ENDPOINT", category: "storage", description: "S3 호환 엔드포인트", requiredInProduction: false, configured: true, value: "https://s3.ap-northeast-2.amazonaws.com", secret: false, fallback: null },
          ],
          checkedAt: new Date().toISOString(),
        }),
      );
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
        // 스키마 적용 상태 (TASK-2301, CTO 결정 2201-①)
        migrations: ready
          ? {
              status: "pass",
              detail: "마이그레이션 34건 모두 적용됨.",
              pending: [],
              unknown: [],
              appliedBy: "operator",
            }
          : {
              status: "fail",
              detail:
                "미적용 마이그레이션 2건: 20260801000000_requirement_cancel, 20260802000000_remote_verify — 운영 담당자가 `pnpm prisma:migrate deploy`를 실행해야 합니다. 애플리케이션은 스키마를 적용하지 않습니다 (CTO 결정 2201-①).",
              pending: [
                "20260801000000_requirement_cancel",
                "20260802000000_remote_verify",
              ],
              unknown: [],
              appliedBy: "operator",
            },
        providers: { available: ready ? ["mock", "openai"] : ["mock"], default: "mock" },
        checklist: ready
          ? [
              { id: "env", title: "환경변수 검증", status: "pass", detail: "22개 항목 이상 없음.", blocking: true },
              { id: "database", title: "데이터베이스 연결", status: "pass", detail: "연결 정상", blocking: true },
              { id: "migrations", title: "마이그레이션 적용", status: "pass", detail: "미적용 마이그레이션 없음.", blocking: true },
              { id: "storage", title: "이미지 저장소 접근", status: "pass", detail: "버킷 접근 정상 (acos)", blocking: true },
              { id: "admin-user", title: "관리자 계정", status: "pass", detail: "ADMIN 계정이 존재합니다.", blocking: true },
              { id: "provider", title: "실제 Provider 연결", status: "pass", detail: "사용 가능: openai (기본 mock)", blocking: false },
              { id: "bucket", title: "이미지 버킷 준비", status: "pass", detail: "acos 확인됨.", blocking: true },
              { id: "iam", title: "저장소 접근 권한 (IAM)", status: "pass", detail: "보호 상태를 읽을 수 있습니다 — 조회 권한이 부여되어 있습니다.", blocking: false },
              { id: "versioning", title: "이미지 버킷 버전 관리", status: "pass", detail: "버전 관리가 켜져 있습니다.", blocking: false },
              { id: "backup-bucket", title: "백업 버킷 준비·분리", status: "pass", detail: "acos-backups 분리됨 · 버전 관리 켜짐.", blocking: true },
              { id: "readiness", title: "재해 복구 판정 (복구 가능 여부)", status: "pass", detail: "복구 가능 — 복구 필수 항목에 실패가 없습니다.", blocking: true },
              { id: "smoke", title: "실 Provider 스모크 (배포 직후 1회)", status: "manual", detail: "node scripts/real-provider-smoke.mjs 실행", blocking: false },
            ]
          : [
              { id: "env", title: "환경변수 검증", status: "fail", detail: "필수/형식 오류 1건 — S3_BUCKET", blocking: true },
              { id: "database", title: "데이터베이스 연결", status: "pass", detail: "연결 정상", blocking: true },
              { id: "migrations", title: "마이그레이션 적용", status: "fail", detail: "미적용 마이그레이션 2건 — 배포 전에 적용하세요.", blocking: true },
              { id: "storage", title: "이미지 저장소 접근", status: "fail", detail: "접근 실패: 버킷을 찾을 수 없습니다", blocking: true },
              { id: "provider", title: "실제 Provider 연결", status: "fail", detail: "mock만 사용 가능합니다 — 운영에서는 실제 Provider 키가 필요합니다.", blocking: true },
              { id: "budget", title: "비용 예산 설정", status: "warn", detail: "예산이 없습니다 — 비용 폭주를 막을 상한이 없습니다.", blocking: false },
              { id: "bucket", title: "이미지 버킷 준비", status: "fail", detail: "acos이(가) 없습니다 — 운영 담당자가 버킷을 만들어야 합니다. 애플리케이션은 만들지 않습니다 (CTO 결정 2101-④).", blocking: true },
              { id: "iam", title: "저장소 접근 권한 (IAM)", status: "warn", detail: "버킷 보호 상태를 읽지 못했습니다 — s3:GetBucketVersioning · s3:GetReplicationConfiguration 권한을 확인하세요. 저장소가 S3인 것과 상태를 읽을 수 있는 것은 다릅니다.", blocking: false },
              { id: "versioning", title: "이미지 버킷 버전 관리", status: "manual", detail: "버전 관리 상태를 알 수 없습니다 — 제공자 콘솔에서 직접 확인하세요.", blocking: false },
              { id: "backup-bucket", title: "백업 버킷 준비·분리", status: "fail", detail: "acos-backups이(가) 없습니다 — 운영 담당자가 만들어야 합니다.", blocking: true },
              { id: "readiness", title: "재해 복구 판정 (복구 가능 여부)", status: "fail", detail: "복구 불가 — 지금 무너지면 되살릴 수 없습니다. /ops/readiness에서 실패 항목을 먼저 해결하세요.", blocking: true },
              { id: "smoke", title: "실 Provider 스모크 (배포 직후 1회)", status: "manual", detail: "node scripts/real-provider-smoke.mjs 실행", blocking: false },
            ],
        summary: ready
          ? { ready: true, pass: 11, fail: 0, warn: 0, manual: 1, blockers: [] }
          : {
              ready: false,
              pass: 1,
              fail: 7,
              warn: 2,
              manual: 2,
              blockers: [
                { id: "env", title: "환경변수 검증", status: "fail", detail: "필수/형식 오류 1건 — S3_BUCKET", blocking: true },
                { id: "migrations", title: "마이그레이션 적용", status: "fail", detail: "미적용 마이그레이션 2건 — 배포 전에 적용하세요.", blocking: true },
                { id: "storage", title: "이미지 저장소 접근", status: "fail", detail: "접근 실패: 버킷을 찾을 수 없습니다", blocking: true },
                { id: "provider", title: "실제 Provider 연결", status: "fail", detail: "mock만 사용 가능합니다 — 운영에서는 실제 Provider 키가 필요합니다.", blocking: true },
                { id: "bucket", title: "이미지 버킷 준비", status: "fail", detail: "acos이(가) 없습니다 — 운영 담당자가 버킷을 만들어야 합니다.", blocking: true },
                { id: "backup-bucket", title: "백업 버킷 준비·분리", status: "fail", detail: "acos-backups이(가) 없습니다 — 운영 담당자가 만들어야 합니다.", blocking: true },
                { id: "readiness", title: "재해 복구 판정 (복구 가능 여부)", status: "fail", detail: "복구 불가 — 지금 무너지면 되살릴 수 없습니다.", blocking: true },
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
  // ── 운영 검증·재해 복구 (TASK-1601) ── ADMIN 전용
  if (
    url.pathname === "/ops/readiness" ||
    url.pathname === "/ops/backup/run" ||
    url.pathname === "/ops/backup/verify-restore" ||
    url.pathname === "/ops/backup/verify-remote" ||
    url.pathname === "/ops/notifications/verify-smtp" ||
    url.pathname === "/ops/drills" ||
    url.pathname === "/ops/drills/require" ||
    url.pathname.startsWith("/ops/drills/requirements/")
  ) {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    const healthy = mode === "data";

    // 변경 후 추가 리허설 요구 (TASK-1901, CTO 결정 1801-⑤)
    if (req.method === "POST" && url.pathname === "/ops/drills/require") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const input = JSON.parse(body || "{}");
        // 같은 Trigger가 미해소면 중복 등록하지 않는다 (CTO 결정 1901-⑤)
        if (
          stubRequirements.some(
            (item) =>
              item.trigger === input.trigger &&
              item.satisfiedAt === null &&
              item.cancelledAt === null,
          )
        ) {
          res.statusCode = 409;
          res.end(
            JSON.stringify({
              message: `같은 Trigger(${input.trigger})가 이미 미해소 상태입니다 — 중복 등록하지 않습니다. 리허설 1회로 함께 해소됩니다.`,
            }),
          );
          return;
        }
        const entry = {
          id: `req-${stubRequirements.length + 1}`,
          trigger: input.trigger,
          description: input.description,
          registeredBy: input.registeredBy,
          satisfiedAt: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          createdAt: new Date().toISOString(),
        };
        stubRequirements.unshift(entry);
        res.statusCode = 201;
        res.end(JSON.stringify(entry));
      });
      return;
    }

    // 요구 취소 (TASK-2001, CTO 결정 1901-② — 삭제는 금지, 취소만 허용)
    if (
      req.method === "POST" &&
      /^\/ops\/drills\/requirements\/[^/]+\/cancel$/.test(url.pathname)
    ) {
      const id = url.pathname.split("/")[4];
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const input = JSON.parse(body || "{}");
        const target = stubRequirements.find((item) => item.id === id);
        if (!target) {
          res.statusCode = 404;
          res.end(JSON.stringify({ message: "요구를 찾을 수 없습니다." }));
          return;
        }
        if (!input.cancelledBy || !input.reason) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({ message: "cancelledBy와 reason은 필수입니다." }),
          );
          return;
        }
        if (target.satisfiedAt !== null) {
          res.statusCode = 409;
          res.end(
            JSON.stringify({
              message: "이미 해소된 요구는 취소할 수 없습니다.",
            }),
          );
          return;
        }
        const cancelled = {
          ...target,
          cancelledAt: new Date().toISOString(),
          cancelledBy: input.cancelledBy,
          cancelReason: input.reason,
        };
        stubRequirements = stubRequirements.map((item) =>
          item.id === id ? cancelled : item,
        );
        res.end(JSON.stringify(cancelled));
      });
      return;
    }

    // 복구 리허설 (TASK-1801, CTO 결정 1701-⑤)
    if (url.pathname === "/ops/drills") {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const input = JSON.parse(body || "{}");
          if (typeof input.ok !== "boolean" || !input.performedBy) {
            res.statusCode = 400;
            res.end(JSON.stringify({ message: "ok와 performedBy는 필수입니다." }));
            return;
          }
          const entry = {
            id: `dr-${stubDrills.length + 1}`,
            ok: input.ok,
            performedBy: input.performedBy,
            durationMs: input.durationMs ?? null,
            findings: input.findings ?? null,
            notes: input.notes ?? null,
            createdAt: new Date().toISOString(),
          };
          stubDrills.unshift(entry);
          // 성공한 리허설만 변경 사건을 해소한다 (결정 1801-⑤)
          if (entry.ok) {
            stubRequirements = stubRequirements.map((item) =>
              item.satisfiedAt === null && item.cancelledAt === null
                ? { ...item, satisfiedAt: entry.createdAt }
                : item,
            );
          }
          res.statusCode = 201;
          res.end(JSON.stringify(entry));
        });
        return;
      }
      res.end(JSON.stringify(stubDrills));
      return;
    }

    if (req.method === "POST" && url.pathname === "/ops/backup/run") {
      stubBackupRan = true;
      res.end(
        JSON.stringify({
          id: "b-new",
          ok: true,
          sizeBytes: 2_400_000,
          fileName: "acos-2026-07-29.dump",
          durationMs: 4200,
          trigger: "manual",
          error: null,
          checksum: "c".repeat(64),
          integrityOk: true,
          entries: 142,
          offsite: false,
          createdAt: new Date().toISOString(),
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/ops/backup/verify-restore") {
      // 미구성(healthy=false)은 **실패가 아니라 하지 못한 것**이다
      stubRestoreVerified = healthy;
      res.end(
        JSON.stringify(
          healthy
            ? {
                id: "r-new",
                ok: true,
                tables: 24,
                fileName: "acos-2026-07-29.dump",
                durationMs: 8100,
                trigger: "manual",
                error: null,
                createdAt: new Date().toISOString(),
                configured: true,
              }
            : {
                id: "not-configured",
                ok: false,
                tables: null,
                fileName: null,
                durationMs: 0,
                trigger: "manual",
                error: "BACKUP_RESTORE_DB_URL이 없어 복원 검증을 하지 않았습니다.",
                createdAt: new Date().toISOString(),
                configured: false,
              },
        ),
      );
      return;
    }

    // 원격 사본 무결성 검증 (TASK-2001) — 전송 비용이 들어 수동 실행이다.
    // 수동은 최근 3건까지 (TASK-2201, CTO 결정 2101-①)
    if (req.method === "POST" && url.pathname === "/ops/backup/verify-remote") {
      const raw = Number(url.searchParams.get("count") ?? 1);
      const count =
        Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 3) : 1;
      stubRemoteVerified = healthy;
      res.end(
        JSON.stringify(
          healthy
            ? {
                status: "pass",
                detail:
                  count === 1
                    ? "원격 사본을 내려받아 대조했습니다 — SHA-256 일치 (cccccccccccc…)."
                    : `최근 ${count}건을 내려받아 대조했습니다 — 모두 SHA-256 일치.`,
                checked: count,
                ok: count,
                failed: 0,
                entries: Array.from({ length: count }, (_, index) => ({
                  fileName: `acos-2026-07-2${9 - index}.dump`,
                  verdict: "ok",
                  detail: "SHA-256 일치",
                })),
              }
            : {
                status: "fail",
                detail:
                  "원격 사본을 찾을 수 없습니다 — 올렸다는 기록만 남아 있고 실제 사본은 없습니다.",
                checked: count,
                ok: 0,
                failed: count,
                entries: [],
              },
        ),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/ops/notifications/verify-smtp") {
      res.end(
        JSON.stringify(
          healthy
            ? {
                configured: true,
                ok: true,
                detail: "SMTP 연결·인증을 확인했습니다 (메일은 보내지 않았습니다).",
                host: "smtp.example.com",
                latencyMs: 120,
              }
            : {
                configured: false,
                ok: false,
                detail:
                  "SMTP_HOST 또는 ALERT_EMAIL_TO가 없습니다 — 메일 경로가 구성되지 않았습니다.",
                host: null,
                latencyMs: 0,
              },
        ),
      );
      return;
    }

    // 재해 복구 판정 — 백업·복원 이력이 없으면 "복구 불가"다
    const backupHistory =
      healthy || stubBackupRan
        ? [
            {
              id: "b-1",
              ok: true,
              sizeBytes: 2_400_000,
              fileName: "acos-2026-07-29.dump",
              durationMs: 4200,
              trigger: stubBackupRan ? "manual" : "schedule",
              error: null,
              checksum: "c".repeat(64),
              integrityOk: healthy,
              entries: 142,
              offsite: healthy,
              createdAt: new Date().toISOString(),
            },
          ]
        : [];
    const restoreHistory =
      healthy || stubRestoreVerified
        ? [
            {
              id: "r-1",
              ok: true,
              tables: 24,
              fileName: "acos-2026-07-29.dump",
              durationMs: 8100,
              trigger: "schedule",
              error: null,
              createdAt: new Date().toISOString(),
            },
          ]
        : [];

    // 리허설 판정은 체크리스트와 enterprise가 같은 값을 써야 한다 —
    // 두 자리가 갈라지면 상태와 설명이 모순된다
    const pendingTriggers = [
      ...new Set(
        stubRequirements
          .filter(
            (item) => item.satisfiedAt === null && item.cancelledAt === null,
          )
          .map((item) => item.trigger),
      ),
    ];
    const drillStatus =
      stubDrills.length === 0
        ? "manual"
        : !stubDrills[0].ok
          ? "fail"
          : pendingTriggers.length > 0
            ? "fail"
            : "pass";
    const drillDetail =
      stubDrills.length === 0
        ? "복구 리허설 기록이 없습니다 — 절차를 읽는 것과 해 보는 것은 다릅니다. 한 번 수행하고 결과를 남기세요."
        : !stubDrills[0].ok
          ? "마지막 복구 리허설이 실패했습니다 — 복구 절차가 지금 상태로는 동작하지 않습니다. 사고가 나기 전에 고치세요."
          : pendingTriggers.length > 0
            ? "변경 이후 리허설을 하지 않았습니다 — 마지막 리허설이 검증한 것은 지금의 시스템이 아닙니다. 주기와 무관하게 즉시 수행하세요 (CTO 결정 1801-⑤)."
            : "마지막 복구 리허설 0일 전 — 다음 예정까지 90일 남았습니다.";

    const checklist = [
      {
        id: "backup",
        title: "백업 존재·신선도",
        status: backupHistory.length > 0 ? "pass" : "fail",
        detail:
          backupHistory.length > 0
            ? "마지막 백업 3분 전 (2400000바이트)."
            : "백업 이력이 없습니다 — 복구할 수 있는 지점이 없습니다.",
        critical: true,
      },
      {
        id: "restore",
        title: "복원 검증",
        status: restoreHistory.length > 0 ? "pass" : "fail",
        detail:
          restoreHistory.length > 0
            ? "복원 검증 통과 — 테이블 24개 확인."
            : "복원 검증 이력이 없습니다 — 복원해 보지 않은 백업은 백업이 아닙니다.",
        critical: true,
      },
      {
        id: "database",
        title: "데이터베이스 연결",
        status: "pass",
        detail: "연결 정상.",
        critical: true,
      },
      {
        id: "storage",
        title: "이미지 저장소 접근",
        status: "pass",
        detail: "버킷 접근 정상.",
        critical: true,
      },
      // Enterprise 항목 (TASK-1701)
      {
        id: "integrity",
        title: "덤프 무결성",
        status: backupHistory.length === 0 ? "manual" : healthy ? "pass" : "fail",
        detail:
          backupHistory.length === 0
            ? "덤프 무결성을 확인하지 못했습니다 — 백업 이력이 없거나 점검이 돌지 않았습니다."
            : healthy
              ? "덤프 목록 판독 정상 — 객체 142개 · SHA-256 cccccccccccc…."
              : "마지막 덤프를 읽을 수 없습니다 — 파일이 손상되었을 수 있습니다. 즉시 다시 받으세요.",
        critical: true,
      },
      {
        id: "restore-target",
        title: "복원 대상 분리",
        status: healthy ? "pass" : "warn",
        detail: healthy
          ? "복원 대상이 운영 데이터베이스와 분리되어 있습니다."
          : "복원 검증 대상 DB가 없습니다 — 복원해 보지 않은 백업은 백업이 아닙니다.",
        critical: true,
      },
      {
        id: "offsite",
        title: "백업 원격 복제",
        status: healthy ? "pass" : "warn",
        detail: healthy
          ? "원격 사본 1개 — 마지막 백업이 원격에도 있습니다."
          : "원격 복제가 꺼져 있습니다 — 백업이 데이터베이스와 같은 곳에만 있어, 그 곳이 사라지면 백업도 함께 사라집니다.",
        critical: false,
      },
      {
        id: "storage-protection",
        title: "이미지 저장소 보호 (버전 관리·복제)",
        status: healthy ? "pass" : "manual",
        detail: healthy
          ? "버전 관리·복제가 모두 켜져 있습니다."
          : "이미지 저장소 — 버전 관리·복제 상태를 알려 주지 않습니다. 제공자 콘솔에서 직접 확인하세요. 운영 저장소 표준은 Amazon S3이며, MinIO·s3rver는 개발 전용이라 조회를 지원하지 않습니다 (CTO 결정 1801-④).",
        critical: false,
      },
      {
        id: "drill",
        title: "복구 리허설 (분기 1회)",
        status: drillStatus,
        detail: drillDetail,
        critical: false,
      },
      {
        id: "backup-bucket-protection",
        title: "백업 버킷 보호 (버전 관리·복제)",
        status: healthy ? "pass" : "manual",
        detail: healthy
          ? "백업 버킷: 버전 관리·복제가 모두 켜져 있습니다."
          : "백업 버킷 — 버전 관리·복제 상태를 알려 주지 않습니다. 제공자 콘솔에서 직접 확인하세요.",
        critical: false,
      },
      {
        id: "backup-performance",
        title: "백업 소요 시간",
        status: healthy ? "pass" : "warn",
        detail: healthy
          ? "마지막 백업 1.2초 · 최근 중앙값 1.1초 (기준 2.0초 미만)."
          : "마지막 백업이 5.0초 걸렸습니다 — 기준 2.0초보다 깁니다. 아직 조치할 수준은 아니지만 추세를 보세요.",
        critical: false,
      },
      // 백업 무결성 (TASK-2001)
      {
        id: "backup-chain",
        title: "백업 사슬 연속성",
        status: healthy ? "pass" : "fail",
        detail: healthy
          ? "최근 24시간에 24/24회 · 최대 공백 1.0시간 (한계 2.0시간)."
          : "백업 사슬에 5.0시간 공백이 있습니다 (최근 24시간에 19/24회). 그 구간은 복구할 수 없습니다 — 개별 백업이 모두 성공이어도, 돌지 않은 백업은 아무 데도 기록되지 않습니다.",
        critical: true,
      },
      {
        id: "remote-integrity",
        title: "원격 사본 무결성",
        status: stubRemoteVerified ? "pass" : "manual",
        detail: stubRemoteVerified
          ? "원격 사본을 내려받아 대조했습니다 — SHA-256 일치 (cccccccccccc…)."
          : "원격 사본을 내려받아 대조하지 않았습니다 — 전송 비용이 들어 기본으로 돌리지 않습니다. 필요할 때 수동으로 확인하세요.",
        critical: false,
      },
      {
        id: "chain-window",
        title: "사슬 관측 창 설정",
        status: healthy ? "pass" : "warn",
        detail: healthy
          ? "관측 창 24.0시간 (기본값)."
          : "설정한 관측 창 12.0시간 — 백업 간격 6.0시간의 4배에 못 미쳐 판정할 표본이 없습니다. 최소 24.0시간까지 올렸습니다. 설정한 값과 실제로 도는 값이 다릅니다 — BACKUP_CHAIN_WINDOW_HOURS를 백업 간격의 4배 이상으로 고치세요. 기동을 막지는 않습니다 (CTO 결정 2101-②).",
        critical: false,
      },
      {
        id: "storage-standard",
        title: "운영 저장소 표준",
        status: "pass",
        detail:
          "개발 저장소 (localhost) — 개발에서는 정상입니다. 운영 표준은 Amazon S3입니다.",
        critical: false,
      },
      {
        id: "objectives",
        title: "복구 목표 (RPO·RTO)",
        status: healthy ? "pass" : "manual",
        detail: healthy
          ? "지금 무너지면 최대 3분치를 잃습니다 (목표 1.0일) · 복원에 8초 걸렸습니다 (목표 30분). 복원 시간은 측정된 하한이며, 장애를 알아차리고 결정하는 시간은 포함하지 않습니다."
          : "복원 검증 측정치가 없어 복구 소요(RTO)를 알 수 없습니다 — 한 번 복원해 보세요.",
        critical: false,
      },
      {
        id: "lock",
        title: "분산 잠금(Redis)",
        status: healthy ? "pass" : "warn",
        detail: healthy
          ? "Redis 응답 정상."
          : "Redis에 연결할 수 없습니다 — 예약 점검이 멈추지만 LLM 호출은 계속됩니다 (CTO 결정 1501-②).",
        critical: false,
      },
      {
        id: "alert-channel",
        title: "경보 전달 채널",
        status: healthy ? "pass" : "warn",
        detail: healthy
          ? "2개 채널이 설정되어 있습니다."
          : "채널이 없습니다 — 사고가 나도 로그에만 남습니다.",
        critical: false,
      },
      {
        id: "runbook",
        title: "복구 절차 숙지·연락 체계",
        status: "manual",
        detail:
          "docs/operations/disaster-recovery.md를 최근에 읽고 절차가 유효한지 확인하세요 (자동 판정 불가).",
        critical: false,
      },
    ];

    res.end(
      JSON.stringify({
        recoverable: checklist.every(
          (item) => !item.critical || item.status !== "fail",
        ),
        summary: {
          pass: checklist.filter((item) => item.status === "pass").length,
          fail: checklist.filter((item) => item.status === "fail").length,
          warn: checklist.filter((item) => item.status === "warn").length,
          manual: checklist.filter((item) => item.status === "manual").length,
        },
        checklist,
        backup: {
          verdict: backupHistory.length > 0 ? "ok" : "missing",
          message:
            backupHistory.length > 0
              ? "마지막 백업 3분 전 (2400000바이트)."
              : "백업 이력이 없습니다 — 복구할 수 있는 지점이 없습니다.",
          ageMs: backupHistory.length > 0 ? 180_000 : null,
          sizeBytes: backupHistory.length > 0 ? 2_400_000 : null,
          history: backupHistory,
          directory: "acos",
          retentionDays: 14,
        },
        restore: {
          verdict: restoreHistory.length > 0 ? "ok" : "missing",
          message:
            restoreHistory.length > 0
              ? "복원 검증 통과 — 테이블 24개 확인."
              : "복원 검증 이력이 없습니다 — 복원해 보지 않은 백업은 백업이 아닙니다.",
          ageMs: restoreHistory.length > 0 ? 3_600_000 : null,
          tables: restoreHistory.length > 0 ? 24 : null,
          history: restoreHistory,
          configured: healthy,
        },
        smtp: healthy
          ? {
              configured: true,
              ok: true,
              detail: "SMTP 연결·인증을 확인했습니다 (메일은 보내지 않았습니다).",
              host: "smtp.example.com",
              latencyMs: 120,
            }
          : {
              configured: false,
              ok: false,
              detail:
                "SMTP_HOST 또는 ALERT_EMAIL_TO가 없습니다 — 메일 경로가 구성되지 않았습니다.",
              host: null,
              latencyMs: 0,
            },
        enterprise: {
          integrity: {
            status:
              backupHistory.length === 0 ? "manual" : healthy ? "pass" : "fail",
            detail:
              backupHistory.length === 0
                ? "덤프 무결성을 확인하지 못했습니다 — 백업 이력이 없거나 점검이 돌지 않았습니다."
                : healthy
                  ? "덤프 목록 판독 정상 — 객체 142개 · SHA-256 cccccccccccc…."
                  : "마지막 덤프를 읽을 수 없습니다 — 파일이 손상되었을 수 있습니다. 즉시 다시 받으세요.",
          },
          offsite: {
            status: healthy ? "pass" : "warn",
            detail: healthy
              ? "원격 사본 1개 — 마지막 백업이 원격에도 있습니다."
              : "원격 복제가 꺼져 있습니다 — 백업이 데이터베이스와 같은 곳에만 있어, 그 곳이 사라지면 백업도 함께 사라집니다.",
            configured: healthy,
            copies: healthy ? 1 : 0,
          },
          storageProtection: {
            status: healthy ? "pass" : "manual",
            detail: healthy
              ? "버전 관리·복제가 모두 켜져 있습니다."
              : "이미지 저장소 — 버전 관리·복제 상태를 알려 주지 않습니다. 제공자 콘솔에서 직접 확인하세요. 운영 저장소 표준은 Amazon S3이며, MinIO·s3rver는 개발 전용이라 조회를 지원하지 않습니다 (CTO 결정 1801-④).",
            versioning: healthy ? "enabled" : "unknown",
            replication: healthy ? "enabled" : "unknown",
          },
          objectives: {
            rpoMs: healthy ? 180_000 : null,
            rpoTargetMs: 86_400_000,
            rpoMet: healthy ? true : null,
            rtoMs: healthy ? 8_100 : null,
            rtoTargetMs: 1_800_000,
            rtoMet: healthy ? true : null,
            status: healthy ? "pass" : "manual",
            detail: healthy
              ? "지금 무너지면 최대 3분치를 잃습니다 (목표 1.0일) · 복원에 8초 걸렸습니다 (목표 30분). 복원 시간은 측정된 하한이며, 장애를 알아차리고 결정하는 시간은 포함하지 않습니다."
              : "복원 검증 측정치가 없어 복구 소요(RTO)를 알 수 없습니다 — 한 번 복원해 보세요.",
          },
          restoreTarget: {
            status: healthy ? "pass" : "warn",
            detail: healthy
              ? "복원 대상이 운영 데이터베이스와 분리되어 있습니다."
              : "복원 검증 대상 DB가 없습니다 — 복원해 보지 않은 백업은 백업이 아닙니다.",
            verdict: healthy ? "ok" : "not-configured",
          },
          drill: {
            status: drillStatus,
            detail: drillDetail,
            pendingTriggers,
            requirements: stubRequirements,
            // 기동 시 자동 등록 결과 (TASK-2101, CTO 결정 2001-④)
            autoRegistration: healthy
              ? {
                  checkedAt: new Date().toISOString(),
                  applied: ["20260729210000_enterprise_backup"],
                  registered: true,
                  detail:
                    "20260729210000_enterprise_backup 적용으로 복구 리허설 요구를 자동 등록했습니다.",
                }
              : {
                  checkedAt: new Date().toISOString(),
                  applied: [],
                  registered: null,
                  detail:
                    "Major Migration을 확인하지 못했습니다: relation \"_prisma_migrations\" does not exist",
                },
            ageMs: stubDrills.length === 0 ? null : 0,
            dueAt:
              stubDrills.length === 0
                ? null
                : new Date(Date.now() + 90 * 86_400_000).toISOString(),
            overdueDays: 0,
            intervalDays: 90,
            history: stubDrills,
          },
          backupBucket: {
            name: healthy ? "acos-backups" : "acos",
            separated: healthy,
            // 백업 버킷도 같은 규칙으로 판정한다 (결정 1801-③)
            protection: {
              status: healthy ? "pass" : "manual",
              detail: healthy
                ? "백업 버킷: 버전 관리·복제가 모두 켜져 있습니다."
                : "백업 버킷 — 버전 관리·복제 상태를 알려 주지 않습니다. 제공자 콘솔에서 직접 확인하세요. 운영 저장소 표준은 Amazon S3이며, MinIO·s3rver는 개발 전용이라 조회를 지원하지 않습니다 (CTO 결정 1801-④).",
              versioning: healthy ? "enabled" : "unknown",
              replication: healthy ? "enabled" : "unknown",
            },
          },
          // 백업 소요 시간 (결정 1801-①)
          performance: {
            level: healthy ? "normal" : "warning",
            status: healthy ? "pass" : "warn",
            detail: healthy
              ? "마지막 백업 1.2초 · 최근 중앙값 1.1초 (기준 2.0초 미만)."
              : "마지막 백업이 5.0초 걸렸습니다 — 기준 2.0초보다 깁니다. 아직 조치할 수준은 아니지만 추세를 보세요.",
            latestMs: healthy ? 1_200 : 5_000,
            medianMs: healthy ? 1_100 : 5_000,
            slowStreak: 0,
          },
          // 버킷·권한 준비 주체 (TASK-2201, CTO 결정 2101-④)
          storageProvisioning: healthy
            ? {
                mode: "external",
                detail:
                  "운영에서는 버킷과 접근 권한을 운영 담당자가 준비합니다 — 애플리케이션은 환경변수로 받은 버킷을 읽고 쓰기만 하며, 만들거나 정책을 바꾸지 않습니다 (CTO 결정 2101-④).",
              }
            : {
                mode: "managed",
                detail:
                  "개발에서는 애플리케이션이 버킷을 만들고 공개 읽기 정책을 겁니다 — 개발자가 손으로 준비하게 하지 않습니다. 운영에서는 하지 않습니다.",
              },
          // 백업 무결성 (TASK-2001)
          backupIntegrity: {
            chain: {
              status: healthy ? "pass" : "fail",
              detail: healthy
                ? "최근 24시간에 24/24회 · 최대 공백 1.0시간 (한계 2.0시간)."
                : "백업 사슬에 5.0시간 공백이 있습니다 (최근 24시간에 19/24회). 그 구간은 복구할 수 없습니다 — 개별 백업이 모두 성공이어도, 돌지 않은 백업은 아무 데도 기록되지 않습니다.",
              expected: 24,
              actual: healthy ? 24 : 19,
              longestGapMs: healthy ? 3_600_000 : 18_000_000,
              // 관측 창 (TASK-2101, CTO 결정 2001-①) — 문제 상태에서는
              // 간격의 4배에 못 미쳐 올린 경우를 보여준다
              windowMs: healthy ? 24 * 3_600_000 : 24 * 3_600_000,
              windowSource: healthy ? "default" : "clamped",
              windowDetail: healthy
                ? "관측 창 24.0시간 (기본값)."
                : "관측 창을 12.0시간로 두면 백업 간격(6.0시간)의 4배에 못 미쳐 판정할 표본이 없습니다 — 24.0시간로 올렸습니다.",
            },
            remote: {
              status: stubRemoteVerified ? "pass" : "manual",
              detail: stubRemoteVerified
                ? "원격 사본이 기록된 체크섬과 일치합니다 (acos-2026-07-29.dump) — 0초 전 대조."
                : "원격 사본을 내려받아 대조하지 않았습니다 — 전송 비용이 들어 기본으로 돌리지 않습니다. 필요할 때 수동으로 확인하세요.",
              verdict: stubRemoteVerified ? "ok" : "unchecked",
              // 수동 대조 상한 (TASK-2201, CTO 결정 2101-①)
              maxManualCount: 3,
              // TASK-2101 — 기록된 대조 결과와 주 1회 예약 (CTO 결정 2001-②)
              checkedAt: stubRemoteVerified ? new Date().toISOString() : null,
              intervalMs: 7 * 24 * 60 * 60 * 1000,
              scheduled: healthy,
            },
            scale: {
              status: healthy ? "pass" : "warn",
              detail: healthy
                ? "데이터베이스 2.0GB — 다음 재평가 기준 10.0GB까지 8.0GB 남았습니다."
                : "데이터베이스가 60.0GB로 재평가 기준 50.0GB를 넘었습니다 — 백업 성능 기준(2초·10초·30초)을 실측으로 다시 재세요 (CTO 결정 1901-④). 기준을 자동으로 바꾸지는 않습니다.",
              bytes: healthy ? 2 * 1024 ** 3 : 60 * 1024 ** 3,
              reachedMilestone: healthy ? null : 50 * 1024 ** 3,
              nextMilestone: healthy ? 10 * 1024 ** 3 : 100 * 1024 ** 3,
            },
            storageStandard: {
              status: "pass",
              detail:
                "개발 저장소 (localhost) — 개발에서는 정상입니다. 운영 표준은 Amazon S3입니다.",
              standard: false,
            },
          },
        },
        redis: {
          configured: true,
          ok: healthy,
          detail: healthy
            ? "Redis 응답 정상."
            : "Redis에 연결할 수 없습니다 — 예약 점검이 멈춥니다.",
          latencyMs: healthy ? 2 : null,
          unhealthySince: healthy ? null : new Date().toISOString(),
          outageThresholdMs: 1_800_000,
        },
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }
  // ── 운영 자동화·경보 (TASK-1302) ── ADMIN 전용
  if (
    url.pathname === "/ops/alerts" ||
    url.pathname === "/ops/checks/run" ||
    url.pathname === "/ops/alerts/archive" ||
    url.pathname === "/ops/alerts/history" ||
    url.pathname === "/ops/notifications" ||
    url.pathname === "/ops/notifications/queue" ||
    url.pathname === "/ops/notifications/queue/drain" ||
    url.pathname === "/ops/notifications/queue/requeue"
  ) {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    const healthy = mode === "data";

    // Alert Archive (TASK-1401) — 삭제가 아니라 보관
    if (req.method === "POST" && url.pathname === "/ops/alerts/archive") {
      stubArchived = healthy ? 0 : 2;
      res.end(
        JSON.stringify({
          archived: stubArchived,
          keys: healthy ? [] : ["budget:old", "configuration:env:S3_BUCKET"],
          afterDays: 90,
          cutoff: new Date().toISOString(),
          checked: 5,
        }),
      );
      return;
    }

    if (url.pathname === "/ops/alerts/history") {
      res.end(
        JSON.stringify({
          entries: [],
          summary: {
            total: 3,
            active: 1,
            resolved: 1,
            archived: 1,
            byKind: [{ kind: "budget", alerts: 2, occurrences: 5 }],
            meanTimeToResolveMs: 3_600_000,
          },
          archiveAfterDays: 90,
          checkedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname === "/ops/notifications") {
      res.end(JSON.stringify([]));
      return;
    }

    // 알림 큐 (TASK-1501) — Retry Worker + Dead Letter Queue
    if (req.method === "POST" && url.pathname === "/ops/notifications/queue/drain") {
      stubQueueDrained = true;
      res.end(
        JSON.stringify({ processed: 1, sent: 1, retried: 0, dead: 0, skipped: null }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/ops/notifications/queue/requeue") {
      stubDeadRequeued = true;
      res.end(JSON.stringify({ requeued: 2 }));
      return;
    }
    if (url.pathname === "/ops/notifications/queue") {
      const dead =
        healthy || stubDeadRequeued
          ? []
          : [
              {
                id: "q-1",
                alertKey: "budget:daily",
                channel: "slack",
                level: "critical",
                title: "일 예산 초과",
                status: "DEAD",
                attempts: 4,
                nextAttemptAt: new Date().toISOString(),
                lastStatus: 404,
                lastError: "HTTP 404",
                sentAt: null,
                deadAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              },
              {
                id: "q-2",
                alertKey: "configuration:env:S3_BUCKET",
                channel: "webhook",
                level: "critical",
                title: "설정 오류 — S3_BUCKET",
                status: "DEAD",
                attempts: 4,
                nextAttemptAt: new Date().toISOString(),
                lastStatus: null,
                lastError: "connect ECONNREFUSED",
                sentAt: null,
                deadAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              },
            ];
      res.end(
        JSON.stringify({
          pending: stubQueueDrained ? 0 : healthy ? 1 : 3,
          sent: stubQueueDrained ? 4 : 3,
          dead: dead.length,
          due: stubQueueDrained ? 0 : 1,
          workerEnabled: healthy,
          workerIntervalMs: 10_000,
          deadLetters: dead,
          recent: dead,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/ops/checks/run") {
      stubChecksRan = true;
      res.end(
        JSON.stringify([
          {
            job: "cost-verification",
            ok: healthy,
            detail: "10건 검사 · 미산정 0건",
            alertsRaised: 0,
            durationMs: 12,
            trigger: "manual",
            notified: [],
          },
        ]),
      );
      return;
    }

    // mode=warn은 **주의 경보만** — 배지가 "이상 없음"으로 어긋나지 않는지 확인용
    // (error 모드는 모든 요청을 500으로 만들어 화면 자체가 뜨지 않는다)
    const criticalAlerts = mode === "warn" ? [] : [
          {
            id: "alert-1",
            kind: "budget",
            key: "budget:daily",
            level: "critical",
            title: "일 예산 초과",
            message:
              "일 지출 $12.0000 / 예산 $10 (120%) — 새 LLM 호출이 차단되고 있습니다.",
            status: "ACTIVE",
            occurrences: 3,
            firstRaisedAt: new Date().toISOString(),
            lastRaisedAt: new Date().toISOString(),
            notifiedAt: new Date().toISOString(),
            resolvedAt: null,
          },
        ];
    const warningAlerts = [
          {
            id: "alert-2",
            kind: "unpriced-model",
            key: "unpriced-model:openai:gpt-5-preview",
            level: "warning",
            title: "가격표에 없는 모델 — gpt-5-preview",
            message:
              "openai/gpt-5-preview 호출 12건의 비용이 집계되지 않았습니다 — 예산 상한이 적용되지 않습니다.",
            status: "ACTIVE",
            occurrences: 1,
            firstRaisedAt: new Date().toISOString(),
            lastRaisedAt: new Date().toISOString(),
            notifiedAt: new Date().toISOString(),
            resolvedAt: null,
          },
        ];
    const active = healthy ? [] : [...criticalAlerts, ...warningAlerts];

    res.end(
      JSON.stringify({
        ok: active.every((alert) => alert.level !== "critical"),
        summary: {
          total: active.length,
          critical: active.filter((alert) => alert.level === "critical").length,
          warning: active.filter((alert) => alert.level === "warning").length,
        },
        active,
        recent: active,
        schedules: [
          {
            job: "cost-verification",
            intervalMs: 900_000,
            dailyAtMinutes: null,
            enabled: true,
            source: "default",
            env: "OPS_CHECK_COST_INTERVAL",
            lastRunAt: stubChecksRan ? new Date().toISOString() : null,
            lastResult: stubChecksRan
              ? {
                  id: "run-1",
                  job: "cost-verification",
                  ok: healthy,
                  detail: "10건 검사 · 미산정 0건",
                  alertsRaised: 0,
                  durationMs: 12,
                  trigger: "manual",
                  createdAt: new Date().toISOString(),
                }
              : null,
          },
          {
            job: "provider-validation",
            intervalMs: 900_000,
            dailyAtMinutes: null,
            enabled: true,
            source: "default",
            env: "OPS_CHECK_CONFIG_INTERVAL",
            lastRunAt: null,
            lastResult: null,
          },
          {
            job: "health-check",
            intervalMs: 3_600_000,
            dailyAtMinutes: null,
            enabled: healthy,
            source: healthy ? "default" : "disabled",
            env: "OPS_CHECK_HEALTH_INTERVAL",
            lastRunAt: null,
            lastResult: null,
          },
          {
            job: "alert-archive",
            intervalMs: 86_400_000,
            dailyAtMinutes: 240,
            enabled: true,
            source: "default",
            env: "OPS_CHECK_ARCHIVE_AT",
            lastRunAt: null,
            lastResult: null,
          },
          {
            job: "backup",
            intervalMs: 3_600_000,
            dailyAtMinutes: null,
            enabled: true,
            source: "default",
            env: "OPS_CHECK_BACKUP_INTERVAL",
            lastRunAt: null,
            lastResult: null,
          },
          {
            job: "restore-verify",
            intervalMs: 86_400_000,
            dailyAtMinutes: 210,
            enabled: true,
            source: "default",
            env: "OPS_CHECK_RESTORE_AT",
            lastRunAt: null,
            lastResult: null,
          },
          // 과금되므로 기본은 꺼져 있다 (CTO 결정 1301-①)
          {
            job: "provider-smoke",
            intervalMs: 86_400_000,
            dailyAtMinutes: 300,
            enabled: false,
            source: "disabled",
            env: "OPS_CHECK_SMOKE_AT",
            lastRunAt: null,
            lastResult: null,
          },
          // 원격 사본 대조 (TASK-2101, CTO 결정 2001-②) — 운영에서만 주 1회
          {
            job: "remote-verify",
            intervalMs: 7 * 86_400_000,
            dailyAtMinutes: null,
            enabled: healthy,
            source: healthy ? "default" : "disabled",
            env: "OPS_CHECK_REMOTE_VERIFY_INTERVAL",
            lastRunAt: null,
            lastResult: null,
          },
        ],
        webhookConfigured: healthy,
        cooldownMs: 1_800_000,
        cooldownByKind: {
          budget: 1_800_000,
          "provider-failure": 1_800_000,
          "unpriced-model": 86_400_000,
          configuration: 1_800_000,
        },
        // 알림 채널 (TASK-1401) — 주소는 담지 않는다
        channels: [
          {
            channel: "slack",
            enabled: healthy,
            minLevel: "warning",
            resolved: true,
            env: "ALERT_SLACK_WEBHOOK_URL",
          },
          {
            channel: "email",
            enabled: false,
            minLevel: "critical",
            resolved: true,
            env: "SMTP_HOST + ALERT_EMAIL_TO",
          },
          {
            channel: "webhook",
            enabled: healthy,
            minLevel: "warning",
            resolved: false,
            env: "ALERT_WEBHOOK_URL",
          },
        ],
        deliveries: healthy
          ? []
          : [
              {
                id: "nd-1",
                alertKey: "budget:daily",
                channel: "slack",
                level: "critical",
                ok: false,
                attempts: 4,
                status: 500,
                error: "HTTP 500",
                createdAt: new Date().toISOString(),
              },
            ],
        coordination: {
          distributed: healthy,
          lockHealthy: healthy,
          instance: "pod-a-1234-abcd",
          lockTtlMs: 30_000,
          leases: [
            {
              key: "scheduler:cost-verification",
              owner: healthy ? "pod-a-1234-abcd" : null,
              self: healthy,
              expiresAt: healthy ? new Date().toISOString() : null,
              remainingMs: healthy ? 25_000 : 0,
            },
            {
              key: "scheduler:provider-validation",
              owner: healthy ? "pod-b-5678-efgh" : null,
              self: false,
              expiresAt: healthy ? new Date().toISOString() : null,
              remainingMs: healthy ? 20_000 : 0,
            },
            {
              key: "scheduler:health-check",
              owner: null,
              self: false,
              expiresAt: null,
              remainingMs: 0,
            },
            {
              key: "scheduler:alert-archive",
              owner: null,
              self: false,
              expiresAt: null,
              remainingMs: 0,
            },
          ],
        },
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
        diagnosticCalls: 2,
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

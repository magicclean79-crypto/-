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
/**
 * 가격표 거버넌스 스텁 상태 (TASK-3101).
 *
 * 실제 서비스처럼 **단계를 지킨다** — 스텁이 아무 전이나 통과시키면
 * "검토 없이 승인할 수 없다"가 화면에서 검증되지 않는다.
 */
let stubProposals = [];
let stubAppliedOcr = null;
/** 예약된 발효 (TASK-3201) — 적용했지만 아직 쓰이지 않는 단가 */
let stubScheduled = [];
/** 감지 실행 이력 (TASK-3301, CTO 정책 3301-④) */
let stubDetectionRuns = [];

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

/** 요청 본문을 JSON으로 (TASK-4301 무시 등록에 쓴다) */
function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
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
      stubProposals = [];
      stubAppliedOcr = null;
      stubScheduled = [];
      stubDetectionRuns = [];
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

  /**
   * 프로젝트 목록 — 업로드 화면의 소속 선택지 (TASK-4501, CTO 정책 4501-②).
   */
  if (url.pathname === "/projects") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        projects: [
          {
            id: "proj-pub",
            name: "발행 테스트 프로젝트",
            description: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            productCount: 1,
            productObjectCount: 1,
          },
        ],
      }),
    );
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
  // ── AI 비용 관리 (TASK-3101, CTO 정책 3101-①③④) ── ADMIN 전용
  if (url.pathname.startsWith("/ops/pricing")) {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");

    const NEXT_STAGES = {
      // 감지 → 승인 → 적용 (TASK-3201, CTO 정책 3201-①)
      DETECTED: ["APPROVED", "REJECTED"],
      DRAFT: ["REVIEWED", "REJECTED"],
      REVIEWED: ["APPROVED", "REJECTED"],
      // 2차 승인·예약 취소 (TASK-3301, CTO 정책 3301-②③)
      APPROVED: ["CONFIRMED", "APPLIED", "REJECTED"],
      CONFIRMED: ["APPLIED", "REJECTED"],
      APPLIED: ["CANCELLED"],
      REJECTED: [],
      CANCELLED: [],
    };
    const priceText = (target, price) =>
      price === null
        ? "가격표에 없던 항목"
        : target === "llm"
          ? `입력 $${price.inputPerMillion}/1M · 출력 $${price.outputPerMillion}/1M`
          : `단위당 $${price.perUnitUsd}`;
    const WAITING = {
      DETECTED: "승인을 기다립니다 (자동 감지 — 근거를 확인하세요)",
      DRAFT: "검토를 기다립니다",
      REVIEWED: "승인을 기다립니다",
      APPROVED: "적용을 기다립니다",
      CONFIRMED: "적용을 기다립니다 (최종 승인 완료)",
      CANCELLED: "예약이 취소되었습니다 — 기록은 남습니다",
      APPLIED: "적용되었습니다 — 이후 호출에 이 단가가 쓰입니다",
      REJECTED: "반려되었습니다",
    };
    const STAGE_LABEL = {
      DETECTED: "감지됨",
      DRAFT: "작성됨",
      REVIEWED: "검토됨",
      APPROVED: "승인됨",
      CONFIRMED: "최종 승인됨",
      APPLIED: "적용됨",
      REJECTED: "반려됨",
      CANCELLED: "예약 취소됨",
    };
    const view = (proposal) => ({
      ...proposal,
      nextStages: NEXT_STAGES[proposal.stage],
      scheduled:
        proposal.effectiveFrom !== null &&
        new Date(proposal.effectiveFrom).getTime() > Date.now(),
      // 운영의 시스템 제안은 최종 승인이 남는다 (TASK-3301, CTO 정책 3301-②).
      // 스텁은 "운영"을 흉내 내기 위해 감지된 제안에 항상 2단계를 요구한다.
      needsSecondApproval:
        proposal.stage === "APPROVED" && proposal.origin !== "manual",
      confirmedBy: proposal.confirmedBy ?? null,
      confirmedAt: proposal.confirmedAt ?? null,
      cancelledBy: proposal.cancelledBy ?? null,
      cancelledAt: proposal.cancelledAt ?? null,
      cancelledReason: proposal.cancelledReason ?? null,
      selfApproval:
        proposal.approvedBy && proposal.approvedBy === proposal.proposedBy
          ? `제안자와 승인자가 같습니다 (${proposal.approvedBy}) — 개발 환경이라 진행하지만 교차 확인은 이뤄지지 않았습니다. 운영에서는 차단됩니다 (CTO 정책 3201-②).`
          : proposal.origin === "detected" && proposal.approvedBy
            ? `감지된 제안을 ${proposal.approvedBy}이(가) 승인했습니다 — 제안자가 시스템이므로 사람의 확인은 1회입니다.`
            : null,
      detail:
        `${proposal.target}/${proposal.key}: ${priceText(proposal.target, proposal.currentPrice)} → ` +
        `${priceText(proposal.target, proposal.price)} · ${STAGE_LABEL[proposal.stage]} — ${WAITING[proposal.stage]}`,
    });

    // 제안 등록
    if (req.method === "POST" && url.pathname === "/ops/pricing") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        if (!parsed.reason || String(parsed.reason).trim() === "") {
          res.statusCode = 400;
          res.end(JSON.stringify({ message: "변경 사유가 필요합니다." }));
          return;
        }
        const proposal = {
          id: `pp-${stubProposals.length + 1}`,
          target: parsed.target,
          key: parsed.key,
          price: parsed.price,
          currentPrice:
            parsed.target === "ocr" && parsed.key === "google-vision"
              ? { perUnitUsd: stubAppliedOcr ?? 0.0015 }
              : null,
          reason: parsed.reason,
          stage: "DRAFT",
          origin: "manual",
          evidence: null,
          effectiveFrom: null,
          confirmedBy: null,
          confirmedAt: null,
          cancelledBy: null,
          cancelledAt: null,
          cancelledReason: null,
          proposedBy: "admin@acos.local",
          reviewedBy: null,
          reviewedAt: null,
          approvedBy: null,
          approvedAt: null,
          appliedBy: null,
          appliedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          rejectedReason: null,
          createdAt: new Date().toISOString(),
        };
        stubProposals.push(proposal);
        res.statusCode = 201;
        res.end(JSON.stringify(view(proposal)));
      });
      return;
    }

    // 가격 변경 감지 (TASK-3201, CTO 정책 3201-①) — 제안까지만 만든다
    if (req.method === "POST" && url.pathname === "/ops/pricing/detect") {
      // data 모드에서는 기록이 새 단가를 가리키는 상황을 재현한다
      // published 모드: 공지 기반 제안 (근거 모양이 다르다 — TASK-3301)
      if (mode === "published") {
        const already = stubProposals.some(
          (row) =>
            row.target === "ocr" &&
            row.key === "google-vision" &&
            !["APPLIED", "REJECTED", "CANCELLED"].includes(row.stage),
        );
        const created = [];
        if (!already) {
          const proposal = {
            id: `pp-${stubProposals.length + 1}`,
            target: "ocr",
            key: "google-vision",
            price: { perUnitUsd: 0.0018 },
            currentPrice: { perUnitUsd: 0.0015 },
            reason:
              "가격 공지가 google-vision 단가를 단위당 $0.0018로 알립니다 (우리 가격표는 $0.0015). 공지 발효 시각: 2026-09-01T00:00:00.000Z",
            stage: "DETECTED",
            origin: "published",
            evidence: {
              source: "published",
              url: "https://provider.example/pricing.json",
              publishedEffectiveFrom: "2026-09-01T00:00:00.000Z",
            },
            effectiveFrom: null,
            confirmedBy: null,
            confirmedAt: null,
            cancelledBy: null,
            cancelledAt: null,
            cancelledReason: null,
            proposedBy: null,
            reviewedBy: null,
            reviewedAt: null,
            approvedBy: null,
            approvedAt: null,
            appliedBy: null,
            appliedAt: null,
            rejectedBy: null,
            rejectedAt: null,
            rejectedReason: null,
            createdAt: new Date().toISOString(),
          };
          stubProposals.push(proposal);
          created.push(view(proposal));
        }
        res.end(
          JSON.stringify({
            source: {
              status: "ok",
              needsHumanCheck: false,
              unparsed: [],
              detail: "가격 공지 1건을 읽었습니다.",
              // Provider별 공지 (TASK-3401 — CTO 결정 3301-⑤)
              sources: [
                {
                  id: "google",
                  url: "https://google.example/pricing.json",
                  format: "acos",
                  status: "ok",
                  unparsedCount: 0,
                  detail: "가격 공지 1건을 읽었습니다.",
                  keys: ["google-vision"],
                },
              ],
              unverifiedKeys: [],
              rejected: [],
            },
            published: [{ target: "ocr", key: "google-vision" }],
            notDue: [],
            changes: [],
            unresolved: [],
            created,
            skipped: [],
            checked: 12,
            detail: "공지 대조 1건 · 제안 1건 등록",
            checkedAt: new Date().toISOString(),
          }),
        );
        return;
      }
      const detectable = mode === "data" && stubAppliedOcr === null;
      const changes = detectable
        ? [
            {
              target: "ocr",
              key: "google-vision",
              impliedPrice: { perUnitUsd: 0.002 },
              currentPrice: { perUnitUsd: 0.0015 },
              samples: 5,
              reason:
                "최근 5건이 모두 단위당 $0.002를 가리킵니다 (가격표는 $0.0015 · 차이 33.3%). " +
                "Provider 단가가 바뀌었거나 우리 가격표가 틀렸습니다 — 확인 후 승인해 주세요.",
            },
          ]
        : [];
      const already = stubProposals.some(
        (row) =>
          row.target === "ocr" &&
          row.key === "google-vision" &&
          !["APPLIED", "REJECTED"].includes(row.stage),
      );
      const created = [];
      for (const change of changes) {
        if (already) {
          break;
        }
        const proposal = {
          id: `pp-${stubProposals.length + 1}`,
          target: change.target,
          key: change.key,
          price: change.impliedPrice,
          currentPrice: change.currentPrice,
          reason: change.reason,
          stage: "DETECTED",
          origin: "detected",
          evidence: {
            from: "2026-07-30T00:00:00.000Z",
            to: "2026-07-30T04:00:00.000Z",
            sampleIds: ["o-1", "o-2", "o-3", "o-4", "o-5"],
            relativeDiff: 0.333,
          },
          effectiveFrom: null,
          // **제안자가 사람이 아니다**
          proposedBy: null,
          reviewedBy: null,
          reviewedAt: null,
          approvedBy: null,
          approvedAt: null,
          appliedBy: null,
          appliedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          rejectedReason: null,
          createdAt: new Date().toISOString(),
        };
        stubProposals.push(proposal);
        created.push(view(proposal));
      }
      stubDetectionRuns.push({
        id: `pdr-${stubDetectionRuns.length + 1}`,
        target: "ocr",
        provider: "google-vision",
        source: "records",
        ranAt: new Date().toISOString(),
        samples: 12,
        changes: changes.length,
        skipped: null,
        detail:
          changes.length > 0
            ? "기록 대조에서 단가 불일치 1건을 찾았습니다."
            : "기록과 가격표가 일치합니다.",
      });
      res.end(
        JSON.stringify({
          // 외부 가격 공지 (TASK-3301, CTO 정책 3301-①).
          // empty 모드에서는 **읽지 못한 상태**를 재현한다 — 그것은
          // "변경 없음"이 아니다.
          source:
            mode === "data"
              ? {
                  status: "ok",
                  needsHumanCheck: false,
                  unparsed: [],
                  detail: "가격 공지 2건을 읽었습니다.",
                  sources: [
                    {
                      id: "openai",
                      url: "https://openai.example/pricing.json",
                      format: "flat",
                      status: "ok",
                      unparsedCount: 0,
                      detail: "가격 공지 1건을 읽었습니다.",
                      keys: ["gpt-4o"],
                    },
                    {
                      id: "google",
                      url: "https://google.example/pricing.json",
                      format: "acos",
                      status: "ok",
                      unparsedCount: 0,
                      detail: "가격 공지 1건을 읽었습니다.",
                      keys: ["google-vision"],
                    },
                  ],
                  unverifiedKeys: [],
                  rejected: [],
                }
              : {
                  // 한 곳이 죽고 한 곳은 읽힌 상태 — 전체는 **가장 나쁜 것**을
                  // 따른다 (TASK-3401, CTO 결정 3301-⑤)
                  status: "unreachable",
                  needsHumanCheck: true,
                  unparsed: [
                    { index: 1, reason: "clova: perUnitUsd가 없습니다." },
                  ],
                  detail:
                    "가격 공지 2곳 중 1곳을 읽었습니다. 읽지 못한 곳: openai(unreachable). 가격 공지를 가져오지 못했습니다: HTTP 503. 공지를 읽지 못한 것은 단가가 그대로라는 뜻이 아닙니다 — 사람이 직접 확인해 주세요 (CTO 정책 3301-①).",
                  sources: [
                    {
                      id: "openai",
                      url: "https://openai.example/pricing.json",
                      format: "flat",
                      status: "unreachable",
                      unparsedCount: 0,
                      detail: "가격 공지를 가져오지 못했습니다: HTTP 503.",
                      keys: ["gpt-4o", "gpt-4o-mini"],
                    },
                    {
                      id: "google",
                      url: "https://google.example/pricing.json",
                      format: "acos",
                      status: "partial",
                      unparsedCount: 1,
                      detail:
                        "가격 공지 1건을 읽었고 1건은 해석하지 못했습니다.",
                      keys: ["google-vision"],
                    },
                  ],
                  // 죽은 공지가 책임지던 단가 (TASK-3501)
                  unverifiedKeys: ["gpt-4o", "gpt-4o-mini"],
                  rejected: [
                    {
                      name: "PRICE_SOURCE_URL_PROJECT_ACME",
                      reason:
                        "프로젝트별 가격 공지는 지원하지 않습니다 (CTO 정책 3301-④와 같은 이유) — 단가는 Provider와의 계약이지 프로젝트의 속성이 아닙니다.",
                    },
                  ],
                },
          published: [],
          notDue: [],
          changes,
          unresolved:
            mode === "data"
              ? []
              : [
                  {
                    target: "llm",
                    key: "gpt-4o",
                    provider: "openai",
                    samples: 7,
                    recordedTotal: 3,
                    expectedTotal: 2.5,
                    reason:
                      "입력·출력 단가 중 어느 것이 바뀌었는지는 기록만으로 가를 수 없습니다 — " +
                      "Provider 공지를 확인해 직접 제안을 내주세요.",
                  },
                ],
          created,
          skipped: already && changes.length > 0 ? ["ocr/google-vision"] : [],
          checked: 12,
          detail:
            `표본 12건 검사 · 감지 ${changes.length}건 제안 ${created.length}건 등록` +
            (changes.length > 0
              ? " — 감지는 제안까지만 만듭니다. 적용은 승인 후 사람이 합니다 (CTO 정책 3201-①)."
              : ""),
          checkedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    // 단계 진행
    const advance = url.pathname.match(/^\/ops\/pricing\/([^/]+)\/([^/]+)$/);
    if (req.method === "POST" && advance) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const [, id, action] = advance;
        const to = {
          review: "REVIEWED",
          approve: "APPROVED",
          // 2차 승인·예약 취소 (TASK-3301, CTO 정책 3301-②③)
          confirm: "CONFIRMED",
          apply: "APPLIED",
          reject: "REJECTED",
          cancel: "CANCELLED",
        }[action];
        const proposal = stubProposals.find((row) => row.id === id);
        if (to === undefined || proposal === undefined) {
          res.statusCode = 400;
          res.end(JSON.stringify({ message: "지원하지 않는 단계입니다." }));
          return;
        }
        if (!NEXT_STAGES[proposal.stage].includes(to)) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              message:
                `${proposal.stage}에서 ${to}로 갈 수 없습니다. ` +
                "단가는 검토 → 승인 → 적용 순서를 건너뛸 수 없습니다 (CTO 정책 3101-①).",
            }),
          );
          return;
        }
        if (to === "REJECTED" && !JSON.parse(body || "{}").reason) {
          res.statusCode = 400;
          res.end(JSON.stringify({ message: "반려 사유가 필요합니다." }));
          return;
        }
        if (to === "CANCELLED") {
          const cancelReason = JSON.parse(body || "{}").reason;
          if (!cancelReason) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({ message: "예약 취소 사유가 필요합니다." }),
            );
            return;
          }
          if (
            proposal.effectiveFrom === null ||
            new Date(proposal.effectiveFrom).getTime() <= Date.now()
          ) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                message:
                  "이미 발효된 단가입니다 — 되돌리려면 새 제안을 내세요 (CTO 정책 3301-③).",
              }),
            );
            return;
          }
          proposal.stage = "CANCELLED";
          proposal.cancelledBy = "admin@acos.local";
          proposal.cancelledAt = new Date().toISOString();
          proposal.cancelledReason = cancelReason;
          // 예약만 사라진다 — 기록은 남는다
          stubScheduled = stubScheduled.filter(
            (row) =>
              !(
                row.target === proposal.target &&
                row.key === proposal.key &&
                row.effectiveFrom === proposal.effectiveFrom
              ),
          );
          res.end(JSON.stringify(view(proposal)));
          return;
        }
        proposal.stage = to;
        const now = new Date().toISOString();
        if (to === "REVIEWED") {
          proposal.reviewedBy = "admin@acos.local";
          proposal.reviewedAt = now;
        } else if (to === "APPROVED") {
          proposal.approvedBy = "admin@acos.local";
          proposal.approvedAt = now;
        } else if (to === "CONFIRMED") {
          proposal.confirmedBy = "reviewer@acos.local";
          proposal.confirmedAt = now;
        } else if (to === "APPLIED") {
          const body2 = JSON.parse(body || "{}");
          const requested = body2.effectiveFrom
            ? new Date(body2.effectiveFrom)
            : null;
          if (requested !== null && requested.getTime() < Date.now() - 60_000) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                message:
                  "과거 시점으로 적용할 수 없습니다 — 이미 기록된 비용을 소급해 다시 해석하게 되고, 그러면 맞았던 기록이 불일치로 바뀝니다 (CTO 정책 3101-②).",
              }),
            );
            return;
          }
          proposal.appliedBy = "admin@acos.local";
          proposal.appliedAt = now;
          proposal.effectiveFrom = (requested ?? new Date()).toISOString();
          const future =
            new Date(proposal.effectiveFrom).getTime() > Date.now();
          if (proposal.target === "ocr" && proposal.key === "google-vision") {
            // **예약은 아직 쓰이지 않는다** (CTO 정책 3201-③)
            if (future) {
              stubScheduled.push({
                target: proposal.target,
                key: proposal.key,
                price: proposal.price,
                effectiveFrom: proposal.effectiveFrom,
              });
            } else {
              stubAppliedOcr = proposal.price.perUnitUsd;
            }
          }
        } else {
          proposal.rejectedBy = "admin@acos.local";
          proposal.rejectedAt = now;
          proposal.rejectedReason = JSON.parse(body || "{}").reason;
        }
        res.end(JSON.stringify(view(proposal)));
      });
      return;
    }

    // 목록 + 실효 가격표
    const applied = stubProposals.filter((row) => row.stage === "APPLIED");
    res.end(
      JSON.stringify({
        open: stubProposals
          .filter(
            (row) => !["APPLIED", "REJECTED", "CANCELLED"].includes(row.stage),
          )
          .map(view)
          .reverse(),
        closed: stubProposals
          // 취소된 예약도 남는다 — 삭제하지 않는다 (CTO 정책 3301-③)
          .filter((row) =>
            ["APPLIED", "REJECTED", "CANCELLED"].includes(row.stage),
          )
          .map(view)
          .reverse(),
        effective: {
          llm: [
            {
              model: "gpt-4o",
              inputPerMillion: 2.5,
              outputPerMillion: 10,
              note: "코드 기본값 — 승인 이력이 없습니다",
            },
          ],
          ocr: [
            {
              provider: "google-vision",
              perUnitUsd: stubAppliedOcr ?? 0.0015,
              note:
                stubAppliedOcr === null
                  ? "TEXT_DETECTION 1,000장 $1.50 기준 (무료 구간은 반영하지 않습니다)"
                  : `승인된 제안으로 적용됨 (${new Date().toISOString()})`,
            },
          ],
          appliedCount: applied.filter((row) => !view(row).scheduled).length,
          lastAppliedAt: applied.length > 0 ? applied.at(-1).appliedAt : null,
          scheduled: stubScheduled,
          nextChangeAt:
            stubScheduled.length > 0 ? stubScheduled[0].effectiveFrom : null,
        },
        detection: {
          providers: [
            {
              provider: "google-vision",
              intervalMs: 6 * 60 * 60 * 1000,
              source: "default",
              env: "PRICE_DETECT_INTERVAL_GOOGLE_VISION",
              lastRunAt:
                stubDetectionRuns.length > 0
                  ? stubDetectionRuns.at(-1).ranAt
                  : null,
              nextAt: null,
            },
          ],
          // 프로젝트별 설정 시도는 거부 사유로 남는다 (CTO 정책 3301-④)
          rejected:
            mode === "data"
              ? []
              : [
                  {
                    name: "PRICE_DETECT_INTERVAL_PROJECT_ACME",
                    reason:
                      "프로젝트별 감지 주기는 지원하지 않습니다 (CTO 정책 3301-④) — 단가는 Provider와의 계약이지 프로젝트의 속성이 아닙니다.",
                  },
                ],
          recent: stubDetectionRuns.slice(-20).reverse(),
        },
        stages: [
          "DETECTED",
          "DRAFT",
          "REVIEWED",
          "APPROVED",
          "CONFIRMED",
          "APPLIED",
          "REJECTED",
          "CANCELLED",
        ],
        detail:
          `진행 중 ${stubProposals.filter((row) => !["APPLIED", "REJECTED", "CANCELLED"].includes(row.stage)).length}건 · ` +
          `발효된 적용 이력 ${applied.length}건. 단가는 검토 → 승인 → 적용 절차를 거치고, ` +
          "감지된 변경은 감지 → 승인 → 적용입니다 (CTO 정책 3101-① · 3201-①). " +
          "감지만으로는 단가가 바뀌지 않습니다. " +
          "적용된 단가는 이후 호출에만 쓰이고, 과거 비용 기록은 바뀌지 않습니다 (정책 3101-②).",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  if (url.pathname === "/ops/cost-forecast" || url.pathname === "/ops/billing") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    const enough = mode === "data";

    if (url.pathname === "/ops/cost-forecast") {
      // data: 관측이 쌓인 상태 / 그 외: 표본 부족 (숫자를 만들지 않는다)
      res.end(
        JSON.stringify(
          enough
            ? {
                verdict: "projected",
                observedDays: 5,
                minDays: 3,
                dailyAverage: 2,
                monthToDate: 10,
                projectedMonthEnd: 62,
                budget: 50,
                projectedRatio: 1.24,
                projectedExceeds: true,
                points: [
                  { date: "2026-07-01", total: 2 },
                  { date: "2026-07-02", total: 2 },
                  { date: "2026-07-03", total: 2 },
                  { date: "2026-07-04", total: 2 },
                  { date: "2026-07-05", total: 2 },
                ],
                unpricedCalls: 0,
                detail:
                  "관측 5일 · 하루 평균 $2.000000 → 월말 예상 $62.000000 / 예산 $50 — 이 추세면 예산을 넘습니다. " +
                  "참고용 추정입니다 — 예산 차단은 실제 비용만 사용합니다 (CTO 정책 3101-③).",
                checkedAt: new Date().toISOString(),
              }
            : {
                verdict: "insufficient",
                observedDays: 2,
                minDays: 3,
                dailyAverage: null,
                monthToDate: 3,
                projectedMonthEnd: null,
                budget: null,
                projectedRatio: null,
                projectedExceeds: false,
                points: [
                  { date: "2026-07-01", total: 1 },
                  { date: "2026-07-02", total: 2 },
                ],
                unpricedCalls: 4,
                detail:
                  "관측 2일 — 예측에는 최소 3일이 필요합니다. 지금까지 실제 지출은 $3.000000입니다. " +
                  "참고용 추정입니다 — 예산 차단은 실제 비용만 사용합니다 (CTO 정책 3101-③). " +
                  "비용이 빠진 호출 4건이 있어 추정도 실제보다 작을 수 있습니다.",
                checkedAt: new Date().toISOString(),
              },
        ),
      );
      return;
    }

    const disclaimer =
      "이 리포트는 운영 지표입니다 — 회계 청구서를 대체하지 않습니다. " +
      "미산정·실패 호출·무료 구간·환율 차이로 실제 청구와 다를 수 있습니다.";
    res.end(
      JSON.stringify({
        period: {
          from: "2026-07-01T00:00:00.000Z",
          to: "2026-07-30T00:00:00.000Z",
        },
        total: enough ? 0.153 : 0,
        bySource: enough ? { llm: 0.15, ocr: 0.003 } : { llm: 0, ocr: 0 },
        rows: enough
          ? [
              {
                source: "llm",
                provider: "openai",
                model: "gpt-4o",
                calls: 2,
                cost: 0.15,
                unpricedCalls: 0,
                share: 0.980392,
              },
              {
                source: "ocr",
                provider: "google-vision",
                model: "text-detection",
                calls: 1,
                cost: 0.003,
                unpricedCalls: 0,
                share: 0.019608,
              },
              {
                source: "llm",
                provider: "openai",
                model: "gpt-9",
                calls: 1,
                cost: null,
                unpricedCalls: 1,
                share: 0,
              },
            ]
          : [],
        calls: enough ? 4 : 0,
        unpricedCalls: enough ? 1 : 0,
        disclaimer,
        detail: enough
          ? "호출 4건 · 합계 $0.153000 (LLM $0.150000 · OCR $0.003000). " +
            "비용이 빠진 호출 1건이 있어 합계는 실제보다 작습니다. " +
            disclaimer
          : `호출 0건 · 합계 $0.000000 (LLM $0.000000 · OCR $0.000000). ${disclaimer}`,
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /**
   * 운영 전환 검증 (TASK-3401, CTO 지시 4·5·6) — ADMIN 전용.
   *
   * 기본(data 모드 포함)은 **스텁을 상대로 돌고 있는 상태**를 재현한다.
   * 이 프로젝트의 라이브 검증이 실제로 그 상태이고, 화면이 그것을 "연결됨"이
   * 아니라 "운영의 그것이 아님"으로 말해야 한다.
   */
  if (url.pathname === "/ops/cutover") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    const verified = mode === "cutover-done";
    res.end(
      JSON.stringify({
        dependencies: [
          {
            id: "llm",
            title: "LLM (실 Provider 호출)",
            status: verified ? "verified" : "not-production",
            detail: verified
              ? "openai 공식 주소로 최근 성공한 실 호출이 12건 있습니다."
              : "OPENAI_BASE_URL로 주소가 바뀌어 있습니다 — 우리 컴퓨터를 가리킵니다 (localhost) — 스텁입니다. 성공 기록 12건은 이 주소를 상대로 만들어졌으므로 운영 연결의 증거가 아닙니다.",
            env: ["LLM_PROVIDER", "OPENAI_API_KEY", "OPENAI_BASE_URL"],
            evidence: verified ? "openai 실 호출 성공 12건" : null,
            next: verified
              ? "추가 조치가 없습니다."
              : "OPENAI_BASE_URL을 비워 공식 주소로 되돌린 뒤 다시 확인하세요.",
          },
          {
            id: "vision",
            title: "Google Cloud Vision (OCR)",
            status: verified ? "verified" : "not-production",
            detail: verified
              ? "공식 주소(vision.googleapis.com)로 최근 성공한 OCR이 4건 있습니다."
              : "GOOGLE_VISION_ENDPOINT가 공식 주소가 아닙니다 — 우리 컴퓨터를 가리킵니다 (127.0.0.1) — 스텁입니다.",
            env: ["OCR_PROVIDER", "GOOGLE_VISION_API_KEY", "GOOGLE_VISION_ENDPOINT"],
            evidence: verified ? "google-vision OCR 성공 4건" : null,
            next: verified
              ? "추가 조치가 없습니다."
              : "GOOGLE_VISION_ENDPOINT를 비워 공식 주소로 되돌린 뒤 OCR을 1회 돌리세요.",
          },
          {
            id: "storage",
            title: "Amazon S3 (운영 저장소)",
            status: verified ? "verified" : "not-production",
            detail: verified
              ? "Amazon S3(s3.ap-northeast-2.amazonaws.com)에 접근했고 버킷이 있습니다."
              : "운영 저장소가 Amazon S3가 아닙니다 (localhost) — MinIO·s3rver는 개발 전용이며 버전 관리·복제 조회를 지원하지 않아 보호 상태를 확인할 수 없습니다 (CTO 결정 1901-③).",
            env: ["S3_ENDPOINT", "S3_BUCKET", "BACKUP_BUCKET"],
            evidence: verified ? "버킷 acos-prod 확인" : null,
            next: verified
              ? "추가 조치가 없습니다."
              : "S3_ENDPOINT를 https://s3.<region>.amazonaws.com으로 바꾸세요.",
          },
          {
            id: "ci",
            title: "GitHub Actions (품질 게이트)",
            status: verified ? "verified" : "invalid",
            detail: verified
              ? "가장 최근 실행(8b6814eb)이 통과했습니다. 필수 게이트 5개가 순서대로 돌았습니다."
              : "가장 최근 실행(8b6814eb)이 failure로 끝났습니다 — 최근 13회 연속 실패입니다. 로컬에서만 통과하는 게이트는 게이트가 아닙니다. 게이트가 파일에 적혀 있는 것과 초록으로 끝나는 것은 다릅니다.",
            env: [],
            evidence: verified ? "run 30571812575 (8b6814eb)" : null,
            next: verified
              ? "추가 조치가 없습니다."
              : "실패한 작업의 로그를 보고 원인을 고치세요.",
          },
        ],
        // 도달 점검 (TASK-3501) — 기본은 openai가 프록시에 막힌 상태를
        // 재현한다. 이 프로젝트의 검증 환경이 실제로 그랬다.
        egress: verified
          ? [
              {
                host: "api.openai.com",
                status: "reachable",
                reachable: true,
                detail: "HTTP 401",
              },
              {
                host: "vision.googleapis.com",
                status: "reachable",
                reachable: true,
                detail: "HTTP 404",
              },
            ]
          : [
              {
                host: "api.openai.com",
                status: "blocked",
                reachable: false,
                detail: "CONNECT tunnel failed, response 403",
              },
              {
                host: "vision.googleapis.com",
                status: "ambiguous",
                reachable: false,
                detail:
                  "HTTP 403 — Provider가 거절한 것인지 중간 프록시가 막은 것인지 가릴 수 없습니다.",
              },
            ],
        summary: { verified: verified ? 4 : 0, total: 4 },
        ready: verified,
        // 전환 대상 환경 (TASK-3501, CTO 정책 3501-①)
        applicable: mode !== "empty",
        environment: mode === "empty" ? "development" : "production",
        detail: verified
          ? "운영 전환 4/4항목이 실제 연결로 확인됐습니다."
          : "운영 전환 0/4항목 확인 — 남은 항목: LLM (실 Provider 호출)(not-production), Google Cloud Vision (OCR)(not-production), Amazon S3 (운영 저장소)(not-production), GitHub Actions (품질 게이트)(invalid). 확인되지 않은 항목을 전환 완료로 세지 않습니다.",
        evidenceWindowDays: 30,
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 운영 활성화 세 조건 (TASK-3601, CTO 정책 3601-①) — ADMIN 전용 */
  if (url.pathname === "/ops/activation") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    const done = mode === "cutover-done";
    res.end(
      JSON.stringify({
        conditions: [
          {
            id: "credentials",
            title: "자격 증명",
            met: done,
            detail: done
              ? "필요한 자격 증명 3개가 모두 설정돼 있습니다 (형식 기준 — 유효성은 실제 호출이 압니다)."
              : "아직인 것 2개: OPENAI_API_KEY(없습니다) · S3_ENDPOINT(Amazon S3를 가리키지 않습니다)",
            next: done ? "추가 조치가 없습니다." : "OPENAI_API_KEY · S3_ENDPOINT를 설정하세요.",
          },
          {
            id: "network",
            title: "네트워크",
            met: done,
            detail: done
              ? "공식 주소 2곳에 모두 닿습니다."
              : "가릴 수 없음 api.openai.com — 403이 Provider의 거절인지 프록시인지 모릅니다",
            next: done
              ? "추가 조치가 없습니다."
              : "실제 호출 1회로 403의 주인이 누구인지 확인하세요.",
          },
          {
            id: "cutover",
            title: "전환 판정 (pnpm cutover)",
            met: done,
            detail: done
              ? "운영 전환 4/4항목이 실제 연결로 확인됐습니다."
              : "운영 전환 0/4항목 확인 — 확인되지 않은 항목을 전환 완료로 세지 않습니다.",
            next: done
              ? "추가 조치가 없습니다."
              : "pnpm cutover가 알려 주는 항목부터 처리하세요.",
          },
        ],
        activated: done,
        applicable: mode !== "empty",
        environment: mode === "empty" ? "development" : "production",
        detail: done
          ? "운영 활성화 완료 — 자격 증명 · 네트워크 · 전환 판정 세 조건이 모두 충족됐습니다 (CTO 정책 3601-①)."
          : "운영 활성화 0/3 조건 충족 — 남은 조건: 자격 증명, 네트워크, 전환 판정 (pnpm cutover). 세 조건이 모두 충족될 때만 완료로 인정합니다 (CTO 정책 3601-①).",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /**
   * 활성화 이력 (TASK-3701, CTO 정책 3701-①) — ADMIN 전용.
   *
   * 화면이 검증해야 하는 것: **되돌아간 것을 붉게 말하는가**, 그리고
   * **아무도 안 본 구간을 '유지됐다'로 보여 주지 않는가**.
   */
  if (url.pathname === "/ops/activation/history") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    if (mode === "empty") {
      res.end(
        JSON.stringify({
          timeline: [],
          activated: null,
          currentSince: null,
          firstActivatedAt: null,
          changes: 0,
          regressions: 0,
          detail:
            "활성화 이력이 없습니다 — 아직 한 번도 판정하지 않았거나 기록이 지워진 것입니다. 이력이 없는 것을 '활성화되지 않았다'로 읽지 않습니다.",
          truncated: false,
        }),
      );
      return;
    }
    const hour = 60 * 60 * 1000;
    const now = Date.now();
    res.end(
      JSON.stringify({
        // 최신이 위 — 지금은 조건 하나가 **빠진** 상태다
        timeline: [
          {
            recordedAt: new Date(now - 5 * hour).toISOString(),
            lastSeenAt: new Date(now - 4 * hour).toISOString(),
            observations: 12,
            activated: false,
            met: ["cutover"],
            environment: "production",
            detail: "운영 활성화 1/3 조건 충족",
            heldMs: 5 * hour,
            ongoing: true,
            unobservedMs: 4 * hour,
            gained: [],
            lost: ["credentials", "network"],
          },
          {
            recordedAt: new Date(now - 30 * hour).toISOString(),
            lastSeenAt: new Date(now - 5 * hour).toISOString(),
            observations: 88,
            activated: false,
            met: ["credentials", "network", "cutover"],
            environment: "production",
            detail: "운영 활성화 3/3 조건 충족",
            heldMs: 25 * hour,
            ongoing: false,
            unobservedMs: 0,
            gained: ["credentials", "network"],
            lost: [],
          },
        ],
        activated: false,
        currentSince: new Date(now - 5 * hour).toISOString(),
        firstActivatedAt: null,
        changes: 1,
        regressions: 1,
        detail:
          "비활성 상태로 5시간째입니다 (충족 1/3). 되돌아간 적 1회 — 한 번 충족된 조건이 다시 빠졌습니다. 만료된 키·닫힌 방화벽처럼 조용히 풀리는 조건이 있다는 뜻입니다. 마지막 확인 이후 4시간 동안 아무도 보지 않았습니다 — 그 구간은 '그대로였다'가 아니라 '모른다'입니다.",
        truncated: false,
      }),
    );
    return;
  }

  /** 운영 스모크 (TASK-3701, CTO 정책 3701-②) — ADMIN 전용 */
  if (url.pathname === "/ops/smoke") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    if (mode === "empty") {
      res.end(
        JSON.stringify({
          results: [
            {
              target: "llm",
              title: "LLM 실제 호출",
              status: "skipped",
              provider: "-",
              baseUrl: null,
              latencyMs: null,
              detail: "한 번도 돌린 적이 없습니다.",
              next: "POST /ops/smoke로 실제 호출을 한 번 돌리세요.",
            },
            {
              target: "ocr",
              title: "OCR(Vision) 실제 호출",
              status: "skipped",
              provider: "-",
              baseUrl: null,
              latencyMs: null,
              detail: "한 번도 돌린 적이 없습니다.",
              next: "POST /ops/smoke로 실제 호출을 한 번 돌리세요.",
            },
            {
              target: "storage",
              title: "S3 실제 쓰기·읽기",
              status: "skipped",
              provider: "-",
              baseUrl: null,
              latencyMs: null,
              detail: "한 번도 돌린 적이 없습니다.",
              next: "POST /ops/smoke로 실제 호출을 한 번 돌리세요.",
            },
          ],
          passed: 0,
          total: 3,
          ok: false,
          detail: "실 호출 0/3 통과. 구성이 실 Provider가 아니어서 부르지 않음: LLM 실제 호출 · OCR(Vision) 실제 호출 · S3 실제 쓰기·읽기.",
          history: [],
          ranAt: null,
        }),
      );
      return;
    }
    // 스텁 상대 성공은 **통과가 아니다** — 이 화면의 핵심이다
    res.end(
      JSON.stringify({
        results: [
          {
            target: "llm",
            title: "LLM 실제 호출",
            status: "stubbed",
            provider: "openai",
            baseUrl: "http://127.0.0.1:9101",
            latencyMs: 42,
            detail:
              "openai/gpt-4o-mini 응답 수신 — 다만 상대가 공식 주소가 아닙니다(http://127.0.0.1:9101). 우리 스텁이 살아 있다는 증거이지 Provider가 붙었다는 증거가 아닙니다.",
            next: "엔드포인트 재정의를 걷어내고 공식 주소로 다시 돌리세요.",
          },
          {
            target: "ocr",
            title: "OCR(Vision) 실제 호출",
            status: "failed",
            provider: "google-vision",
            baseUrl: "https://vision.googleapis.com",
            latencyMs: 310,
            detail: "HTTP 403 API key not valid",
            next: "실패 사유를 그대로 읽으세요 — 형식·도달 점검을 통과하고도 여기서 깨지는 것은 결제·권한·모델 접근처럼 실제로 불러야만 보이는 문제입니다.",
          },
          {
            target: "storage",
            title: "S3 실제 쓰기·읽기",
            status: "passed",
            provider: "s3",
            baseUrl: "https://s3.ap-northeast-2.amazonaws.com",
            latencyMs: 88,
            detail: "버킷 acos에 쓰기·읽기·삭제 성공",
            next: "추가 조치가 없습니다.",
          },
        ],
        passed: 1,
        total: 3,
        ok: false,
        detail:
          "실 호출 1/3 통과. 실패: OCR(Vision) 실제 호출. 스텁 응답이라 통과로 세지 않음: LLM 실제 호출 (성공했지만 상대가 공식 주소가 아닙니다).",
        history: [],
        ranAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 운영 장애 이력 (TASK-3701, CTO 정책 3701-④) — ADMIN 전용 */
  if (url.pathname === "/ops/incidents") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    if (mode === "empty") {
      res.end(
        JSON.stringify({
          incidents: [],
          drafts: 0,
          dismissed: 0,
          open: 0,
          resolved: 0,
          mttrMs: null,
          mttdMs: null,
          totalDowntimeMs: 0,
          withoutCause: 0,
          longestId: null,
          detail:
            "기록된 장애가 없습니다 — 장애가 없었다는 뜻일 수도, 아무도 적지 않았다는 뜻일 수도 있습니다. 장애는 자동으로 열리지 않습니다.",
          checkedAt: new Date().toISOString(),
        }),
      );
      return;
    }
    const hour = 60 * 60 * 1000;
    const now = Date.now();
    res.end(
      JSON.stringify({
        incidents: [
          {
            id: "inc-open",
            component: "llm",
            severity: "CRITICAL",
            summary: "OpenAI 호출 전량 실패",
            startedAt: new Date(now - 3 * hour).toISOString(),
            detectedAt: null,
            resolvedAt: null,
            cause: null,
            recovery: null,
            durationMs: 3 * hour,
            ongoing: true,
            detectionMs: null,
            recoveryMs: null,
            durationLabel: "3시간 0분째 진행 중",
            status: "CONFIRMED",
            sourceAlertKey: null,
            dismissedAt: null,
            dismissReason: null,
            fixKind: null,
            rootCause: null,
            temporaryFix: null,
            permanentFix: null,
            prevention: null,
            needsFollowUp: false,
          },
          {
            // 경보에서 자동으로 만든 **초안** (TASK-3901, 정책 3901-⑤)
            id: "inc-draft",
            component: "llm",
            severity: "CRITICAL",
            summary: "openai 호출 실패율 급증",
            startedAt: new Date(now - 5 * hour).toISOString(),
            detectedAt: new Date(now - 5 * hour).toISOString(),
            resolvedAt: null,
            cause: "CRITICAL 경보가 45분째 이어져 자동으로 만든 초안입니다.",
            recovery: null,
            durationMs: 5 * hour,
            ongoing: true,
            detectionMs: 0,
            recoveryMs: null,
            durationLabel: "5시간 0분째 진행 중",
            status: "DRAFT",
            sourceAlertKey: "provider-failure:openai",
            dismissedAt: null,
            dismissReason: null,
            fixKind: null,
            rootCause: null,
            temporaryFix: null,
            permanentFix: null,
            prevention: null,
            needsFollowUp: false,
          },
          {
            id: "inc-done",
            component: "storage",
            severity: "MAJOR",
            summary: "S3 업로드 실패",
            startedAt: new Date(now - 50 * hour).toISOString(),
            detectedAt: new Date(now - 49 * hour).toISOString(),
            resolvedAt: new Date(now - 48 * hour).toISOString(),
            cause: "버킷 정책 오설정",
            recovery: "정책을 되돌리고 재배포",
            durationMs: 2 * hour,
            ongoing: false,
            detectionMs: hour,
            recoveryMs: hour,
            durationLabel: "2시간 0분",
            status: "CONFIRMED",
            sourceAlertKey: null,
            fixKind: "permanent",
            rootCause: "버킷 정책 오설정",
            temporaryFix: null,
            permanentFix: "정책을 되돌리고 재배포",
            prevention: null,
            dismissedAt: null,
            dismissReason: null,
            needsFollowUp: false,
          },
        ],
        drafts: 1,
        dismissed: 0,
        open: 1,
        resolved: 1,
        mttrMs: 2 * hour,
        mttdMs: hour,
        totalDowntimeMs: 2 * hour,
        withoutCause: 0,
        longestId: "inc-open",
        detail:
          "진행 중인 장애 1건 — 가장 오래된 것이 3시간 0분째입니다(OpenAI 호출 전량 실패). 진행 중인 시간은 최종값이 아니며 평균에도 넣지 않습니다. 복구 1건의 평균 지속 시간 2시간 0분. 평균 감지 시간 1시간 0분.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 운영 KPI (TASK-3801, CTO 정책 3801-③) — ADMIN 전용 */
  if (url.pathname === "/ops/kpi") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    // 화면이 검증해야 하는 것: **모르는 지표를 초록으로 칠하지 않는가**,
    // 그리고 **좋아 보이는 0에 주석이 달리는가**.
    res.end(
      JSON.stringify({
        kpis: [
          {
            id: "activation",
            title: "운영 활성화",
            value: 1,
            unit: "/3 조건",
            status: "bad",
            basis: "충족 1/3 — 아직 전환되지 않았습니다.",
            caveat: "되돌아간 적 1회 — 조용히 풀리는 조건이 있습니다.",
            threshold: null,
          },
          {
            id: "smoke",
            title: "실 호출 스모크",
            value: 33.3,
            unit: "%",
            status: "bad",
            basis: "실행 3건 중 공식 주소로 통과 1건.",
            caveat: "1건은 스텁 응답이라 통과로 세지 않았습니다.",
            threshold: null,
          },
          {
            id: "incidents-open",
            title: "진행 중인 장애",
            value: 0,
            unit: "건",
            status: "good",
            basis: "지금 열려 있는 장애 0건.",
            caveat:
              "기록된 장애가 하나도 없습니다 — 장애가 없었다는 뜻일 수도, 아무도 적지 않았다는 뜻일 수도 있습니다.",
            // 운영자가 **느슨하게** 바꾼 임계값 (TASK-3901, 정책 3901-②)
            threshold:
              "운영자 조정값 (기본 0/1건 → 3/5건) — **기준을 느슨하게 바꾼 것이며, 상태가 좋아진 것이 아닙니다.**",
          },
          {
            id: "mttr",
            title: "평균 복구 시간",
            value: null,
            unit: "분",
            status: "unknown",
            basis: "표본이 없어 평균을 낼 수 없습니다.",
            caveat: "0분이 아니라 '모른다'입니다.",
            threshold: null,
          },
          {
            id: "mttd",
            title: "평균 감지 시간",
            value: null,
            unit: "분",
            status: "unknown",
            basis: "표본이 없어 평균을 낼 수 없습니다.",
            caveat: "0분이 아니라 '모른다'입니다.",
            threshold: null,
          },
          {
            id: "follow-up",
            title: "영구 조치 대기",
            value: 2,
            unit: "건",
            status: "watch",
            basis: "임시 조치로 닫힌 뒤 영구 조치를 기다리는 장애 2건.",
            caveat: "목록에서는 '복구됨'으로 보이지만 원인은 그대로 있습니다.",
            threshold: null,
          },
          {
            id: "alerts",
            title: "활성 경보",
            value: 0,
            unit: "건",
            status: "unknown",
            basis: "지금 살아 있는 경보 0건.",
            caveat:
              // 값이 0일 때의 문구다 — 값과 어긋나는 주석은 주석 전체를
              // 무시하게 만든다 (TASK-3801 라이브 결함)
              "예약 점검이 돌고 있지 않습니다 — 이 숫자가 0인 것은 조용해서가 아니라 아무도 보고 있지 않아서일 수 있습니다.",
            threshold: null,
          },
          {
            id: "checks",
            title: "예약 점검 통과율",
            value: 100,
            unit: "%",
            status: "good",
            basis: "12회 중 12회 통과.",
            caveat: null,
            threshold: null,
          },
          {
            id: "ci",
            title: "CI 통과율",
            value: 91.7,
            unit: "%",
            status: "watch",
            basis: "12회 중 11회 통과.",
            caveat: null,
            threshold: null,
          },
        ],
        windowDays: 30,
        unknown: 3,
        bad: 2,
        adjusted: 1,
        relaxed: 1,
        rejected: [
          {
            key: "kpi.threshold.mttr.watch",
            reason:
              "평균 복구 시간 임계값은 5~1440분 사이여야 합니다 (받은 값: 99999분). 범위 밖의 값은 임계값이 아니라 **임계값을 없앤 것**이고, 그건 설정이 아니라 우회입니다.",
          },
        ],
        detail:
          "최근 30일 기준. 나쁨 2개: 운영 활성화 · 실 호출 스모크. 값을 낼 수 없는 지표 3개: 평균 복구 시간 · 평균 감지 시간 · 활성 경보 — 모르는 것을 좋음으로 세지 않습니다. 임계값을 **느슨하게** 바꾼 지표 1개 — 기준을 내린 것이지 상태가 좋아진 것이 아닙니다.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 운영 설정 현황 (TASK-3901, CTO 정책 3901-②③④⑤) — ADMIN 전용 */
  /**
   * KPI 추세 (TASK-4001, CTO 정책 4001-②) — ADMIN 전용.
   *
   * 화면이 검증해야 하는 것: **한 점으로 선을 긋지 않는가**(스냅샷이
   * 하나면 "0% 변화"가 아니라 "낼 수 없음"), 그리고 **기준이 움직인
   * 구간을 개선으로 읽지 않는가**.
   */
  if (url.pathname === "/ops/kpi/trend") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        trends: [
          {
            kpiId: "mttr",
            title: "평균 복구 시간",
            direction: "worsening",
            delta: 140,
            unit: "분",
            comparedTo: "2026-07-01T00:00:00.000Z",
            samples: 12,
            thresholdChanged: false,
            detail: "평균 복구 시간 60분 → 200분 (+140분, 표본 12개)",
          },
          {
            kpiId: "incidents-open",
            title: "진행 중인 장애",
            direction: "flat",
            delta: 0,
            unit: "건",
            comparedTo: "2026-07-01T00:00:00.000Z",
            samples: 12,
            thresholdChanged: true,
            detail:
              "진행 중인 장애 1건 → 1건 (+0건, 표본 12개) 이 구간에 임계값이 " +
              "바뀌었습니다 — 값은 비교할 수 있지만 정상/주의/나쁨의 변화는 " +
              "상태가 아니라 기준이 움직인 결과입니다.",
          },
          {
            kpiId: "smoke",
            title: "실 호출 스모크",
            direction: "unknown",
            delta: null,
            unit: "%",
            comparedTo: null,
            samples: 1,
            thresholdChanged: false,
            detail: "스냅샷이 1개뿐입니다 — 한 점으로는 추세가 아닙니다.",
          },
        ],
        windowDays: 30,
        improving: 0,
        worsening: 1,
        unknown: 1,
        thresholdChanged: 1,
        lastTakenAt: "2026-07-30T04:00:00.000Z",
        detail:
          "최근 30일 추세. 나빠지는 중 1개: 평균 복구 시간. 추세를 낼 수 없는 " +
          "지표 1개 — 표본이 부족하거나 값을 낼 수 없었던 시점이 있습니다. " +
          "이 구간에 임계값이 바뀐 지표 1개 — 색의 변화를 상태의 변화로 읽지 마세요.",
      }),
    );
    return;
  }

  /** KPI 임계값 변경 이력 (TASK-4001, CTO 정책 4001-③) — ADMIN 전용 */
  if (url.pathname === "/ops/kpi/history") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify([
        {
          id: "chg-1",
          key: "kpi.threshold.incidents-open.good",
          title: "진행 중인 장애 정상 경계",
          action: "SETTING_UPDATED",
          before: "0",
          after: "3",
          actor: "admin@acos.local",
          relaxed: true,
          createdAt: "2026-07-20T02:00:00.000Z",
        },
        {
          id: "chg-2",
          key: "kpi.threshold.mttd.good",
          title: "평균 감지 시간 정상 경계",
          action: "SETTING_CLEARED",
          before: "10",
          after: null,
          // 판정할 수 없는 것을 false로 적으면 목록이 안전해 보인다
          relaxed: null,
          actor: "admin@acos.local",
          createdAt: "2026-07-18T02:00:00.000Z",
        },
      ]),
    );
    return;
  }

  /**
   * 검증 스프린트 준비 (TASK-4001, CTO 정책 4001-⑥) — ADMIN 전용.
   *
   * 화면이 검증해야 하는 것: **사람이 줄 것이 남았는데 "시작할 수 있다"고
   * 말하지 않는가**, 그리고 **막힌 것과 안 한 것을 가르는가**.
   */
  if (url.pathname === "/ops/validation-plan") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        steps: [
          {
            id: "credentials",
            title: "실 Provider 자격 증명 주입",
            owner: "operator",
            why: "실 호출 없이 재는 모든 숫자는 스텁의 숫자입니다.",
            evidence: "GET /ops/activation의 credentials 조건이 충족으로 바뀝니다.",
            status: "pending",
            detail: "실 자격 증명이 아직 없습니다 — 지금 재는 값은 스텁의 값입니다.",
            blockedBy: [],
          },
          {
            id: "smoke",
            title: "실 호출 스모크 3종 통과",
            owner: "system",
            why: "스텁 통과는 계약 확인이지 연결 확인이 아닙니다.",
            evidence: "POST /ops/smoke가 세 대상 모두 passed이고, stubbed가 0건입니다.",
            status: "blocked",
            detail:
              "앞 단계가 끝나지 않아 시작할 수 없습니다 (실 Provider 자격 증명 주입). " +
              "실 호출 스모크를 아직 돌리지 않았습니다.",
            blockedBy: ["credentials"],
          },
          {
            id: "baseline",
            title: "KPI 기준선 확보",
            owner: "system",
            why: "시작 시점의 점이 없으면 끝나고 나서 비교할 대상이 없습니다.",
            evidence: "KPI 스냅샷이 2점 이상 쌓여 추세를 낼 수 있습니다.",
            status: "done",
            detail: "스냅샷 12점 — 추세를 낼 수 있습니다.",
            blockedBy: [],
          },
        ],
        readiness: "blocked",
        done: 1,
        total: 3,
        waitingOnPeople: 1,
        waitingOnUs: 0,
        unknown: 0,
        blocked: 1,
        detail:
          "검증 스프린트 준비 1/3 단계 완료. 사람이 줘야 끝나는 단계 1건: " +
          "실 Provider 자격 증명 주입. 이 단계들은 코드로 해결되지 않습니다. " +
          "앞 단계가 막혀 시작할 수 없는 단계 1건: 실 호출 스모크 3종 통과. " +
          "이 단계들은 우리가 부지런해져서 풀리지 않습니다.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 운영 진단 (TASK-4001, CTO 정책 4001-④⑤) — ADMIN 전용 */
  if (url.pathname === "/ops/diagnostics") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        stage: "daily",
        checks: [
          {
            id: "env",
            title: "환경변수",
            status: "ok",
            detail: "필수 환경변수가 모두 설정돼 있습니다.",
            next: null,
          },
          {
            id: "migrations",
            title: "마이그레이션 적용",
            status: "unknown",
            detail: "적용 상태를 읽지 못했습니다 — 0건이라는 뜻이 아닙니다.",
            next: "pnpm --filter api exec prisma migrate status로 직접 확인하세요.",
          },
          {
            id: "urgent-channel",
            title: "긴급 알림 경로",
            status: "warn",
            detail:
              "운영인데 긴급 경로가 없어 급한 알림이 일반 채널로 나갑니다. " +
              "지금은 동작하지만, 급한 것이 안 급한 것들 사이에 묻힙니다 — " +
              "폴백은 임시 조치이고 임시 조치는 아무도 보지 않으면 영구가 됩니다.",
            next: "ALERT_URGENT_SLACK_WEBHOOK_URL 또는 ALERT_URGENT_WEBHOOK_URL을 설정하세요.",
          },
        ],
        ok: 1,
        warn: 1,
        fail: 0,
        unknown: 1,
        blocked: false,
        // TASK-4101 (정책 4101-②③)
        tier: "staging",
        comparison: {
          regressed: [
            { id: "urgent-channel", title: "긴급 알림 경로", from: "ok", to: "warn" },
          ],
          recovered: [],
          persisting: [],
          // **복구와 절대 섞지 않는다** — 없어진 검사는 실패하지 않는다
          disappeared: [
            { id: "activation", title: "운영 활성화", from: "warn", to: null },
          ],
          appeared: [],
          comparable: true,
          comparedTo: "2026-07-30T07:00:00.000Z",
          detail:
            "새로 나빠진 항목 1건: 긴급 알림 경로(정상 → 주의). 지난 진단 " +
            "이후에 바뀐 것이 있다는 뜻입니다. 이번 진단에 없는 항목 1건: " +
            "운영 활성화. 고쳐진 것이 아니라 검사 자체가 없어진 것입니다 — " +
            "없어진 검사는 실패하지 않습니다.",
        },
        detail:
          "[스테이징] 일일 진단. 주의 1건. 모르는 것 1건 — 통과로 세지 않았습니다. " +
          "진단 결과와 무관하게 서비스는 계속 뜹니다 (경보와 차단은 다릅니다).",
        ranAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /**
   * 검증 실행 잠금 (TASK-4101, CTO 정책 4101-⑤⑥) — ADMIN 전용.
   *
   * 화면이 검증해야 하는 것: **막힌 이유를 그대로 보여 주는가**,
   * 그리고 **되돌릴 수 없는 단계를 표시하는가**.
   */
  if (url.pathname === "/ops/validation-run") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        verdict: "blocked",
        blockers: [
          {
            id: "target",
            reason:
              "검증 대상 판정이 'unacknowledged'입니다 — 대상이 성립하지 않으면 " +
              "실 호출을 돌리지 않습니다.",
          },
          {
            id: "people",
            reason:
              "사람이 줘야 끝나는 단계가 1건 남았습니다: 실 Provider 자격 증명 " +
              "주입. 이 단계들은 코드로 해결되지 않습니다.",
          },
        ],
        steps: [
          {
            order: 1,
            id: "preflight",
            title: "준비 상태 재확인",
            command: "GET /ops/validation-plan",
            onFailure: "여기서 멈춥니다.",
            reversible: true,
          },
          {
            order: 2,
            id: "diagnostics",
            title: "대상 환경 진단",
            command: "GET /ops/diagnostics?stage=startup",
            onFailure: "실패 항목을 고친 뒤 다시 시작합니다.",
            reversible: true,
          },
          {
            order: 3,
            id: "baseline",
            title: "검증 전 KPI 스냅샷",
            command: "POST /ops/kpi/snapshot",
            onFailure: "기준선 없이 시작하면 비교할 대상이 없습니다.",
            reversible: true,
          },
          {
            order: 4,
            id: "smoke",
            title: "실 호출 스모크 3종",
            command: "POST /ops/smoke",
            onFailure: "스텁으로 되돌려 통과시키지 않습니다.",
            reversible: false,
          },
        ],
        tier: "staging",
        target: {
          verdict: "unacknowledged",
          url: "https://staging.acos.example",
          host: "staging.acos.example",
          usable: false,
          detail:
            "주소는 성립하지만 VALIDATION_TARGET_ACK가 없습니다 — 주소를 적는 " +
            "것과 그곳에 돈이 나가는 호출을 돌려도 된다고 말하는 것은 다른 " +
            "행동입니다.",
          next: "VALIDATION_TARGET_ACK=staging.acos.example을 설정하세요.",
        },
        detail:
          "검증을 시작할 수 없습니다 (2건). 강제로 여는 방법은 없습니다 — 막는 " +
          "조건을 없애는 것이 유일한 길입니다.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 운영 호스트 목록 검증 (TASK-4201, CTO 정책 4201-①) — ADMIN 전용 */
  if (url.pathname === "/ops/hosts") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        findings: [
          {
            host: "acos.example",
            verdict: "declared",
            sources: ["PUBLIC_BASE_URL"],
            detail: "선언된 운영 호스트이며 실제로 쓰이고 있습니다 (PUBLIC_BASE_URL).",
          },
          {
            host: "cdn.acos.example",
            verdict: "undeclared",
            sources: ["S3_PUBLIC_URL"],
            detail:
              "cdn.acos.example는 쓰이고 있는데 PRODUCTION_HOSTS에 없습니다 " +
              "(S3_PUBLIC_URL). 이것이 운영 호스트라면 검증 대상 보호가 이 " +
              "주소를 통과시킵니다 — 목록에 넣어 주세요.",
          },
        ],
        declared: 1,
        undeclared: 1,
        unseen: 0,
        required: true,
        detail:
          "선언된 운영 호스트 1개. 목록에 없는데 쓰이는 호스트 1개: " +
          "cdn.acos.example. 이것이 운영이라면 검증 대상 보호가 그 주소를 " +
          "통과시킵니다 — 목록을 고쳐 주세요. 자동으로 넣지 않는 이유는 " +
          "그러면 스테이징까지 운영으로 올라가 정작 검증 대상이 막히기 " +
          "때문입니다.",
        // 운영 트래픽 관측 (TASK-4301, 정책 4301-①) — **허가가 아니다**
        discovery: {
          sightings: [
            {
              host: "m.acos.example",
              requests: 812,
              firstSeenAt: "2026-07-29T02:00:00.000Z",
              lastSeenAt: "2026-07-31T11:00:00.000Z",
            },
          ],
          distinct: 1,
          overflowed: false,
          detail:
            "운영 트래픽에서 호스트 1개를 봤습니다 (요청 812건). 관측은 " +
            "증거이지 허가가 아닙니다 — Host 헤더는 요청하는 쪽이 적는 " +
            "값이므로 이 목록을 운영 호스트로 자동 등록하지 않습니다.",
        },
        // 신뢰하는 프록시 (TASK-4401, 정책 4401-①)
        trustedProxy: {
          declared: 1,
          rejected: [],
          untrusted: 2,
          ambiguous: 0,
          viaProxy: 812,
          status: "warn",
          detail:
            "신뢰하는 프록시 1개가 선언돼 있습니다. 신뢰하지 않는 상대가 " +
            "전달 헤더를 보낸 요청 2건을 버렸습니다 — 프록시인 척한 " +
            "요청이거나 프록시 주소 선언이 빠진 것입니다.",
        },
      }),
    );
    return;
  }

  /** 미귀속 실행 경로 (TASK-4401, CTO 정책 4401-②) — ADMIN 전용 */
  if (url.pathname === "/ops/cost/attribution") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        rows: [
          {
            key: "llm:vision-analysis",
            feature: "vision-analysis",
            source: "llm",
            total: 14,
            attributed: 2,
            missing: 12,
            coverage: 14.3,
            detail: "vision-analysis: 14건 중 12건에 프로젝트가 붙지 않았습니다.",
          },
          {
            key: "llm:content-generation",
            feature: "content-generation",
            source: "llm",
            total: 30,
            attributed: 30,
            missing: 0,
            coverage: 100,
            detail: "content-generation: 30건 모두 귀속됐습니다.",
          },
        ],
        total: 44,
        attributed: 32,
        missing: 12,
        coverage: 72.7,
        target: 95,
        minSample: 20,
        verdict: "below",
        windowHours: 24,
        detail:
          "귀속 대상 44건 중 32건 귀속 (72.7%). 목표 95%에 못 미칩니다. " +
          "가장 많이 빠뜨리는 경로는 vision-analysis입니다 (12건). 귀속률만 " +
          "보면 \"덜 됐다\"까지만 알 수 있고, 어디를 고쳐야 하는지는 이 목록이 " +
          "말합니다.",
        next: "vision-analysis 호출 경로에서 프로젝트가 전달되는지 확인하세요.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 운영 활성화 런북 (TASK-4401, CTO 정책 4401-⑤) — ADMIN 전용 */
  if (url.pathname === "/ops/runbook") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        steps: [
          {
            id: "preflight",
            title: "사전 점검 통과",
            owner: "system",
            why: "무엇이 막고 있는지 모른 채 시작하면 실패의 원인을 가릴 수 없습니다.",
            evidence: "pnpm validation:preflight가 exit 0입니다.",
            rollback: "아무것도 바꾸지 않는 단계입니다 — 되돌릴 것이 없습니다.",
            irreversible: false,
            source: "GET /ops/readiness-board",
            state: "pending",
            detail: "검증 스프린트 준비 2/11 단계 완료.",
          },
          {
            id: "credentials",
            title: "실 Provider 자격 증명 주입",
            owner: "operator",
            why: "실 호출 없이 재는 모든 숫자는 스텁의 숫자입니다.",
            evidence: "GET /ops/activation의 credentials 조건이 충족입니다.",
            rollback:
              "환경변수를 비우고 재기동하면 즉시 스텁으로 돌아갑니다. 이미 " +
              "나간 호출의 과금은 되돌릴 수 없습니다.",
            irreversible: false,
            source: "GET /ops/activation",
            state: "pending",
            detail: "실 자격 증명이 아직 없습니다.",
          },
          {
            id: "smoke",
            title: "실 호출 스모크 3종",
            owner: "system",
            why: "스텁 통과는 계약 확인이지 연결 확인이 아닙니다.",
            evidence: "POST /ops/smoke가 세 대상 모두 passed입니다.",
            rollback:
              "되돌릴 수 없습니다 — 이 단계부터 외부에 요청이 나가고 " +
              "과금됩니다. 중단은 할 수 있지만 이미 나간 호출은 취소되지 " +
              "않습니다.",
            irreversible: true,
            source: "GET /ops/smoke",
            state: "pending",
            detail: "실 호출 스모크를 아직 돌린 적이 없습니다.",
          },
          {
            id: "observe",
            title: "전환 후 관측 창 유지",
            owner: "system",
            why: "전환 직후의 정상은 아직 아무것도 안 해 본 정상입니다.",
            evidence: "KPI 스냅샷이 전환 전후로 각각 있습니다.",
            rollback: "관측은 아무것도 바꾸지 않습니다.",
            irreversible: false,
            source: "GET /ops/kpi/trend",
            state: "unknown",
            detail: "이 단계의 상태를 읽지 못했습니다 — 됐다는 뜻이 아닙니다.",
          },
        ],
        done: 0,
        total: 4,
        nextStepId: "preflight",
        irreversibleStarted: false,
        waitingOnPeople: ["실 Provider 자격 증명 주입"],
        detail:
          "운영 활성화 런북 0/4 단계 완료. 다음 단계는 \"사전 점검 통과\"입니다. " +
          "사람이 줘야 끝나는 단계 1건: 실 Provider 자격 증명 주입. 이 " +
          "단계들은 코드로 해결되지 않습니다. 상태를 읽지 못한 단계 1건은 " +
          "통과로 세지 않았습니다: 전환 후 관측 창 유지.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 작업 목록 (TASK-4603) — ADMIN 전용 */
  if (url.pathname === "/jobs") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        jobs: [
          {
            id: "job-timeout",
            kind: "ocr-batch",
            status: "failed",
            attempts: 1,
            completedStages: ["ocr:1:img-a", "ocr:2:img-b"],
            totalStages: 5,
            failureKind: "timeout",
            userMessage:
              "처리 시간이 예상보다 길어져 중단했습니다. 잠시 후 다시 시도해 주세요.",
            resumable: true,
            totalMs: 61234,
            requestId: "req-abcdef12",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            detail:
              "2/5단계에서 멈췄습니다. 끝난 단계는 체크포인트에 남아 있어 이어할 수 있습니다.",
          },
          {
            id: "job-blocked",
            kind: "ocr-batch",
            status: "failed",
            attempts: 1,
            completedStages: [],
            totalStages: 3,
            failureKind: "blocked",
            userMessage:
              "지금은 이 작업을 실행할 수 없습니다. 화면에 적힌 이유를 확인해 주세요.",
            resumable: false,
            totalMs: 120,
            requestId: null,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            detail:
              "0/3단계에서 멈췄습니다. 이어해도 같은 결과가 나오는 실패입니다 — 원인을 먼저 고쳐 주세요.",
          },
          {
            id: "job-ok",
            kind: "ocr-batch",
            status: "succeeded",
            attempts: 2,
            completedStages: ["ocr:1:img-a", "ocr:2:img-b"],
            totalStages: 2,
            failureKind: null,
            userMessage: null,
            resumable: false,
            totalMs: 2400,
            requestId: "req-99887766",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            detail: "2/2단계를 끝냈습니다.",
          },
        ],
      }),
    );
    return;
  }

  /** 단계별 성능 추세 (TASK-4603) — ADMIN 전용 */
  if (url.pathname === "/jobs/metrics/stages") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        trends: [
          {
            kind: "ocr-batch",
            stage: "ocr:*",
            samples: 12,
            medianMs: 8200,
            p95Ms: 15400,
            verdict: "slow",
            detail: "중앙값 8.2초로 기준(5.0초)을 넘습니다. 95%는 15.4초 안에 끝납니다.",
          },
          {
            kind: "ocr-batch",
            stage: "fetch:*",
            samples: 2,
            medianMs: 90,
            p95Ms: 120,
            verdict: "insufficient",
            detail:
              "표본이 2건으로 5건에 못 미쳐 느린지 판정하지 않았습니다 — 빠르다는 뜻도 느리다는 뜻도 아닙니다.",
          },
        ],
        undecided: 1,
        windowHours: 168,
        detail:
          "최근 7일 · 단계 2종. 기준(5000ms)을 넘는 단계 1종: ocr:*. " +
          "표본이 모자라 판정하지 않은 단계 1종 — 빠르다는 뜻이 아닙니다.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /**
   * 통합 운영 대시보드 (TASK-4601, CTO 정책 4601-⑤) — ADMIN 전용.
   *
   * 못 읽은 갈래가 하나 있는 상태를 그대로 보여 준다 — 요약 문장이 그
   * 사실을 **먼저** 말해야 한다.
   */
  if (url.pathname === "/ops/overview") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        tiles: [
          {
            id: "validation",
            title: "Validation",
            question: "실 Provider를 상대로 확인한 것이 있는가",
            source: "GET /ops/go-live",
            status: "fail",
            detail:
              "실 Production Validation이 아직 성공하지 않았습니다 — 아직 시작도 안 했다는 뜻입니다.",
            next: "남은 조건: 실 Production Validation 성공",
            read: true,
          },
          {
            id: "attribution",
            title: "Attribution",
            question: "이 비용이 누구 것인지 아는가",
            source: "GET /ops/cost/attribution",
            status: "unknown",
            detail: "표본이 20건에 못 미쳐 달성 여부를 판정하지 않았습니다.",
            next: null,
            read: true,
          },
          {
            id: "notification",
            title: "Notification",
            question: "장애가 나면 사람에게 닿는가",
            source: "GET /ops/notifications/health",
            status: "warn",
            detail:
              "켜진 채널 2개 중 1개가 최근 도달했습니다. 확인되지 않은 채널 1개: teams.",
            next: "POST /ops/notifications/test로 지금 닿는지 확인하세요.",
            read: true,
          },
          {
            id: "recovery",
            title: "Recovery",
            question: "잘못됐을 때 되돌릴 수 있는가",
            source: "GET /ops/drills",
            status: "unknown",
            detail: "이 갈래를 읽지 못했습니다 — 괜찮다는 뜻이 아닙니다.",
            next: null,
            read: false,
          },
        ],
        status: "fail",
        unknown: 2,
        unread: 1,
        undecided: 1,
        detail:
          "1개 갈래를 읽지 못했습니다(Recovery) — 이 화면의 요약은 그만큼 덜 본 " +
          "것입니다. 1개 갈래는 읽었지만 판정을 유보했습니다(Attribution) — " +
          "정상이라는 뜻이 아니라 아직 판단할 근거가 모자라다는 뜻입니다. " +
          "운영 상태 실패 — 실패 1 · 주의 1 · 확실하지 않음 2. " +
          "먼저 할 일: Validation — 남은 조건: 실 Production Validation 성공",
        nextAction: "남은 조건: 실 Production Validation 성공",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 알림 건강도 (TASK-4601, CTO 정책 4601-④) — ADMIN 전용 */
  if (url.pathname === "/ops/notifications/health") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        channels: [
          {
            channel: "webhook",
            verdict: "reached",
            attempts: 3,
            successes: 3,
            lastSuccessAt: new Date().toISOString(),
            detail: "최근 24시간 안에 3건 도달했습니다.",
            next: null,
          },
          {
            channel: "teams",
            verdict: "silent",
            attempts: 0,
            successes: 0,
            lastSuccessAt: new Date(Date.now() - 3 * 86400000).toISOString(),
            detail:
              "최근 24시간 안에 보낸 것이 없습니다. 마지막 도달은 3일 전입니다. " +
              "보낼 일이 없어 조용한 것인지 주소가 죽은 것인지 가릴 수 없습니다.",
            next: "POST /ops/notifications/test로 지금 닿는지 확인하세요.",
          },
        ],
        reached: 1,
        active: 2,
        status: "warn",
        windowHours: 24,
        owners: [{ owner: "김운영", channel: "email" }],
        ownersRejected: ["이름만"],
        ownersDetail:
          "담당자 1명의 직접 경로가 설정돼 있습니다. 읽을 수 없는 선언 1개를 " +
          "버렸습니다 (이름만) — 오타 하나로 담당자 한 명이 조용히 빠지지 " +
          "않도록 그대로 적습니다.",
        teamsFormat: "message-card",
        teamsFormatDetail:
          "Teams 본문은 MessageCard입니다(기본값). Adaptive Card로 바꾸려면 " +
          "TEAMS_CARD_FORMAT=adaptive 한 줄이며, 되돌리는 것도 같은 한 줄입니다.",
        detail:
          "켜진 채널 2개 중 1개가 최근 도달했습니다. 확인되지 않은 채널 1개: teams — " +
          "보낼 일이 없어 조용한 것인지 죽은 것인지 가릴 수 없습니다.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /**
   * 최종 Go-Live 체크리스트 (TASK-4501, CTO 정책 4501-⑤) — ADMIN 전용.
   *
   * 검증이 성공하지 않은 상태를 그대로 보여 준다: 나머지가 초록이어도
   * **준비 완료가 아니라 아직 시작도 안 한 것**이다.
   */
  if (url.pathname === "/ops/go-live") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        verdict: "not-started",
        items: [
          {
            id: "validation",
            title: "실 Production Validation 성공",
            why: "실 호출 없이 얻은 초록은 전부 스텁의 초록입니다.",
            evidence:
              "POST /ops/validation-run/execute가 성공으로 끝난 기록이 있고, " +
              "그 실행에서 스텁 응답이 0건입니다.",
            source: "POST /ops/validation-run/execute",
            state: "unmet",
            detail:
              "실 Production Validation을 아직 한 번도 돌린 적이 없습니다 — " +
              "실패가 아니라 안 한 것입니다.",
          },
          {
            id: "runbook",
            title: "운영 활성화 런북 전 단계 완료",
            why: "순서를 건너뛰고 도달한 상태는 되돌릴 곳을 모르는 상태입니다.",
            evidence: "GET /ops/runbook의 모든 단계가 done입니다.",
            source: "GET /ops/runbook",
            state: "unmet",
            detail: "운영 활성화 런북 0/4 단계 완료.",
          },
          {
            id: "drill",
            title: "되돌리는 절차 확인",
            why: "되돌릴 수 없다면 그건 검증이 아니라 그냥 전환입니다.",
            evidence: "최근 복구 리허설이 성공했습니다.",
            source: "GET /ops/drills",
            state: "unknown",
            detail: "이 항목의 상태를 읽지 못했습니다 — 됐다는 뜻이 아닙니다.",
          },
        ],
        met: 0,
        total: 3,
        blocking: [
          "실 Production Validation 성공",
          "운영 활성화 런북 전 단계 완료",
          "되돌리는 절차 확인",
        ],
        lastValidation: null,
        detail:
          "실 Production Validation이 아직 성공하지 않았습니다. 실 Production " +
          "Validation을 아직 한 번도 돌린 적이 없습니다 — 실패가 아니라 안 한 " +
          "것입니다. 이 상태에서 나머지 항목이 초록인 것은 준비가 끝났다는 뜻이 " +
          "아니라 아직 시작도 안 했다는 뜻입니다 — 지금까지의 초록은 전부 스텁을 " +
          "상대로 얻은 것입니다.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /**
   * Production Readiness Dashboard (TASK-4301, CTO 정책 4301-④) — ADMIN 전용.
   *
   * **여기서 새로 판정하지 않는다** — 각 칸은 어느 판정에서 왔는지를 달고
   * 다니고, 읽지 못한 칸은 unknown이다(통과가 아니다).
   */
  if (url.pathname === "/ops/readiness-board") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        tiles: [
          {
            id: "validation-plan",
            title: "검증 준비 단계",
            status: "blocked",
            detail: "검증 스프린트 준비 2/11 단계 완료.",
            source: "GET /ops/validation-plan",
            next: "사람이 줘야 끝나는 단계: 실 Provider 자격 증명 주입",
          },
          {
            id: "validation-run",
            title: "검증 실행 잠금",
            status: "blocked",
            detail: "4가지 이유로 막혀 있습니다: 검증 대상이 정해지지 않았습니다",
            source: "GET /ops/validation-run",
            next: "강제로 여는 방법은 없습니다 — 막는 조건을 없애야 합니다.",
          },
          {
            id: "diagnostics",
            title: "운영 진단",
            status: "unknown",
            detail: "이 판정을 읽지 못했습니다 — 괜찮다는 뜻이 아닙니다.",
            source: "GET /ops/diagnostics",
            next: "GET /ops/diagnostics이 응답하는지 확인해 주세요.",
          },
          {
            id: "hosts",
            title: "운영 호스트 목록",
            status: "warn",
            detail: "선언된 운영 호스트 1개. 목록에 없는데 쓰이는 호스트 1개.",
            source: "GET /ops/hosts",
            next: "목록에 없는 호스트가 운영인지 사람이 답해야 합니다.",
          },
          {
            id: "neglect",
            title: "방치",
            status: "warn",
            detail:
              "기준을 넘게 그대로인 항목 1건 (무시 중 1건 · 검토일 지남 0건) — " +
              "가장 오래된 것은 오브젝트 저장소(23일째)입니다.",
            source: "GET /ops/neglect",
            next: null,
          },
          {
            id: "attribution",
            title: "비용 귀속",
            status: "ok",
            detail:
              "지금 들어오는 기록 100% · 최근 창 전체 40% — 옛 기록은 고칠 수 " +
              "없으므로 전체는 천천히 따라옵니다.",
            source: "GET /ops/cost/projects",
            next: null,
          },
        ],
        steps: { done: 2, total: 11 },
        readiness: "blocked",
        blockers: ["validation-plan", "validation-run"],
        unknowns: ["diagnostics"],
        fail: 0,
        warn: 2,
        tier: "staging",
        detail:
          "[staging] 운영 준비 화면. 준비 2/11 단계 (사람이 줄 것이 남음). " +
          "지금 막고 있는 것 2가지: 검증 준비 단계 · 검증 실행 잠금. " +
          "확인하지 못한 칸 1개는 통과로 세지 않았습니다: 운영 진단. " +
          "이 화면은 다른 판정을 인용만 합니다 — 여기서 다시 판정하면 같은 " +
          "사실에 두 개의 답이 생기고, 어긋나는 순간 둘 다 못 믿게 됩니다.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 방치 항목 무시 (TASK-4301, CTO 정책 4301-③) — 사유·담당자·검토일 필수 */
  if (/^\/ops\/neglect\/[^/]+\/ignore$/.test(url.pathname) && req.method === "POST") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    const body = await readJson(req);
    res.setHeader("content-type", "application/json");
    if (typeof body.owner !== "string" || body.owner.trim() === "") {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          message:
            "담당자가 필요합니다. 팀 이름이 아니라 사람이어야 합니다 — " +
            "검토일이 왔을 때 아무에게도 돌아가지 않으면 그 무시는 영구 " +
            "삭제와 같습니다.",
        }),
      );
      return;
    }
    if (typeof body.reason !== "string" || body.reason.trim().length < 10) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          message:
            "무시하는 이유를 10자 이상 적어 주세요. 검토일에 이 글을 읽는 " +
            "사람은 지금의 사정을 모릅니다.",
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        id: "ignore-1",
        detail:
          `${body.owner}가 30일 뒤에 다시 봅니다. 그때까지 경보만 쉬고, ` +
          "목록과 연속 기간은 그대로 갑니다 — 무시는 해결이 아닙니다.",
      }),
    );
    return;
  }

  /** 방치 무시 취소 (TASK-4301) — 행은 남고 취소 기록이 붙는다 */
  if (/^\/ops\/neglect\/ignores\/[^/]+\/revoke$/.test(url.pathname) && req.method === "POST") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        revoked: true,
        detail: "무시를 취소했습니다. 이 항목은 다시 경보 대상입니다.",
      }),
    );
    return;
  }

  /** 방치 지표 (TASK-4201, CTO 정책 4201-②) — ADMIN 전용 */
  if (url.pathname === "/ops/neglect") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        streaks: [
          {
            id: "storage",
            title: "오브젝트 저장소",
            status: "fail",
            runs: 21,
            since: "2026-07-08T07:00:00.000Z",
            durationDays: 23,
            durationLabel: "23일",
            truncated: true,
            detail:
              "오브젝트 저장소: 21회 연속 · 23일째 기록이 남은 구간 내내 " +
              "나빴습니다 — 실제로는 더 오래됐을 수 있으니 최소값으로 읽으세요. " +
              "이 정도면 대응 중인 것이 아니라 대응하지 않기로 한 것에 " +
              "가깝습니다.",
            // 무시 중이지만 목록에도 남고 기간도 계속 간다 (TASK-4301)
            ignored: true,
            ignoreId: "ignore-1",
            ignoreOwner: "김운영",
            ignoreReason: "S3 전환이 다음 분기 계획에 잡혀 있습니다",
            ignoreReviewAt: "2026-08-20T00:00:00.000Z",
            reviewOverdue: false,
            ignoreLabel: "무시 중 · 20일 뒤 검토 (김운영)",
          },
          {
            id: "urgent-channel",
            title: "긴급 알림 경로",
            status: "warn",
            runs: 2,
            since: "2026-07-30T07:00:00.000Z",
            durationDays: 1,
            durationLabel: "1일",
            truncated: false,
            detail: "긴급 알림 경로: 2회 연속 · 1일째",
            ignored: false,
            ignoreId: null,
            ignoreOwner: null,
            ignoreReason: null,
            ignoreReviewAt: null,
            reviewOverdue: false,
            ignoreLabel: null,
          },
        ],
        worst: {
          id: "storage",
          title: "오브젝트 저장소",
          status: "fail",
          runs: 21,
          since: "2026-07-08T07:00:00.000Z",
          durationDays: 23,
          durationLabel: "23일",
          truncated: true,
          detail: "오브젝트 저장소: 21회 연속 · 23일째",
          ignored: true,
          ignoreId: "ignore-1",
          ignoreOwner: "김운영",
          ignoreReason: "S3 전환이 다음 분기 계획에 잡혀 있습니다",
          ignoreReviewAt: "2026-08-20T00:00:00.000Z",
          reviewOverdue: false,
          ignoreLabel: "무시 중 · 20일 뒤 검토 (김운영)",
        },
        runs: 21,
        largestGapDays: null,
        neglectAfterDays: 7,
        ignoredCount: 1,
        overdueCount: 0,
        maxIgnoreDays: 90,
        detail:
          "진단 21회를 봤습니다. 나쁜 항목 2개 중 가장 오래된 것은 오브젝트 " +
          "저장소(23일째)입니다. 7일 넘게 그대로인 항목 1개: 오브젝트 저장소. " +
          "실패 수가 늘지 않았다고 나아진 것이 아닙니다. 이 중 1건은 무시 " +
          "중입니다 — 방치 건수에서 빼지 않았습니다. 무시는 경보를 쉬게 할 뿐 " +
          "해결이 아닙니다.",
      }),
    );
    return;
  }

  /** 프로젝트별 비용 (TASK-4201, CTO 정책 4201-④) — ADMIN 전용 */
  if (url.pathname === "/ops/cost/projects") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        rows: [
          {
            projectId: "proj-1",
            name: "상세페이지 프로젝트",
            cost: 1.2,
            calls: 40,
            unpricedCalls: 3,
            share: 30,
          },
        ],
        attributed: 1.2,
        // **나누지 않는다** — 자기 칸에 그대로 둔다
        unattributed: 2.8,
        diagnostic: 0,
        total: 4,
        unpricedCalls: 3,
        unattributedCalls: 60,
        coverage: 40,
        // 지금 들어오는 기록은 멀쩡하다 — 옛 기록 때문에 전체가 낮다 (TASK-4301)
        recentCoverage: 100,
        recentCalls: 12,
        recentWindowHours: 24,
        unattributable: 0,
        unattributableCalls: 0,
        windowDays: 30,
        detail:
          "최근 30일 · 프로젝트 1개에 $1.200000 귀속. 귀속되지 않은 호출 " +
          "60건($2.800000) — 프로젝트를 알 수 없는 기록입니다. 이 금액을 " +
          "프로젝트별로 나눠 얹지 않았습니다: 배분할 수 없는 것을 배분하면 " +
          "그 숫자는 관측이 아니라 만들어낸 것이 됩니다. 금액을 낼 수 없는 " +
          "호출 3건이 있습니다(가격표에 없는 모델) — 위 금액은 모두 " +
          "최소값입니다. 이것은 주인을 모르는 것과 다른 문제입니다.",
        caveat:
          "귀속률 40% — 나머지는 프로젝트를 알 수 없는 기록이고, 그 금액은 " +
          "어느 프로젝트에도 더해지지 않았습니다. 이 표로 비용을 청구한다면 " +
          "실제 사용량보다 적게 청구됩니다.",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  /** 만료 초안 되살림 이력 (TASK-4101, CTO 정책 4101-④) — ADMIN 전용 */
  if (url.pathname === "/ops/incidents/revivals") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        revivals: [
          {
            id: "inc-draft-0",
            summary: "경보에서 만든 초안: 저장소 응답 지연",
            action: "confirm",
            reason: "비슷한 사고가 다시 나서 되짚어 보니 같은 원인이었습니다",
            latenessDays: 23,
            actor: "admin@acos.local",
            revivedAt: "2026-07-24T02:00:00.000Z",
            detail:
              "만료 23일 뒤 확인 (초안 → 장애) — 비슷한 사고가 다시 나서 " +
              "되짚어 보니 같은 원인이었습니다",
          },
        ],
        total: 1,
        confirmed: 1,
        dismissed: 0,
        reopened: 0,
        averageLatenessDays: 23,
        detail:
          "만료 뒤 손댄 초안 1건 (확인 1 · 기각 0 · 만료 취소 0). 평균 23일 늦게 " +
          "봤습니다. 만료된 초안 중 1건이 실제 장애였습니다 — 이것은 잘 처리한 " +
          "기록이 아니라 그만큼 늦게 알았다는 기록입니다.",
      }),
    );
    return;
  }

  /** 장애 초안 수명 (TASK-4001, CTO 정책 4001-①) — ADMIN 전용 */
  if (url.pathname === "/ops/incidents/drafts") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        stale: [
          {
            id: "inc-draft-1",
            summary: "경보에서 만든 초안: OpenAI 호출 실패",
            createdAt: "2026-07-25T02:00:00.000Z",
            ageDays: 6,
          },
        ],
        expiring: [],
        expired: [
          {
            id: "inc-draft-0",
            summary: "경보에서 만든 초안: 저장소 응답 지연",
            createdAt: "2026-06-01T02:00:00.000Z",
            expiredAt: "2026-07-01T04:00:00.000Z",
          },
        ],
        staleAfterDays: 3,
        expireAfterDays: 30,
        detail:
          "3일 넘게 확인되지 않은 초안 1건 — 감시가 무언가를 잡았는데 아무도 " +
          "보지 않았다는 뜻입니다.",
      }),
    );
    return;
  }

  if (url.pathname === "/ops/settings") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        thresholds: [
          {
            id: "incidents-open",
            title: "진행 중인 장애",
            unit: "건",
            direction: "lower-is-better",
            good: 3,
            watch: 5,
            defaultGood: 0,
            defaultWatch: 1,
            isDefault: false,
            relaxed: true,
            min: 0,
            max: 20,
          },
          {
            id: "mttr",
            title: "평균 복구 시간",
            unit: "분",
            direction: "lower-is-better",
            good: 60,
            watch: 240,
            defaultGood: 60,
            defaultWatch: 240,
            isDefault: true,
            relaxed: false,
            min: 5,
            max: 1440,
          },
        ],
        retention: [
          {
            target: "ops-audit",
            title: "운영 감사 기록",
            days: 365,
            defaultDays: 365,
            isDefault: true,
            minDays: 180,
            maxDays: 3650,
            why: "감사 기록은 사고가 난 뒤에 거슬러 올라가는 용도입니다. 반년보다 짧게 두는 것은 보존 정책이 아니라 감사를 끄는 것입니다.",
          },
          {
            target: "ops-events",
            title: "운영 이벤트",
            days: 180,
            defaultDays: 180,
            isDefault: true,
            minDays: 90,
            maxDays: 3650,
            why: "이벤트는 활성화가 언제 완료됐고 언제 풀렸는지의 기록입니다.",
          },
        ],
        urgentChannels: [
          { channel: "slack", env: "ALERT_URGENT_SLACK_WEBHOOK_URL", configured: false },
          { channel: "webhook", env: "ALERT_URGENT_WEBHOOK_URL", configured: true },
          { channel: "email", env: "ALERT_URGENT_EMAIL_TO", configured: false },
        ],
        promotion: { enabled: true, afterMinutes: 30 },
        rejected: [],
      }),
    );
    return;
  }

  /** 운영 이벤트 (TASK-3801, CTO 정책 3801-①) — ADMIN 전용 */
  if (url.pathname === "/ops/events") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    if (mode === "empty") {
      res.end(JSON.stringify([]));
      return;
    }
    res.end(
      JSON.stringify([
        {
          id: "evt-2",
          kind: "activation-lost",
          title: "운영 활성화가 풀렸습니다",
          message:
            "충족돼 있던 조건이 빠졌습니다: 자격 증명 (production). 되던 것이 안 되는 상태입니다 — 키 만료·방화벽 규칙 정리처럼 조용히 풀리는 원인을 먼저 확인하세요.",
          urgent: true,
          environment: "production",
          notifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        {
          id: "evt-1",
          kind: "activation-completed",
          title: "운영 활성화 완료",
          message:
            "자격 증명 · 네트워크 · 전환 판정 세 조건이 모두 충족됐습니다 (production).",
          urgent: false,
          // 못 보냈으면 못 보낸 채로 보여 준다
          notifiedAt: null,
          environment: "production",
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ]),
    );
    return;
  }

  /** 운영 감사 기록 (TASK-3801, CTO 정책 3801-④) — ADMIN 전용 */
  if (url.pathname === "/ops/audit") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    res.setHeader("content-type", "application/json");
    if (mode === "empty") {
      res.end(JSON.stringify([]));
      return;
    }
    res.end(
      JSON.stringify([
        {
          id: "audit-2",
          action: "incident.run",
          title: "장애 기록 생성",
          method: "POST",
          path: "/ops/incidents",
          target: null,
          actorEmail: "admin@acos.local",
          outcome: "failed",
          statusCode: 400,
          durationMs: 12,
          detail: "component · severity=CRITICAL · summary",
          requestId: "req-2",
          createdAt: new Date().toISOString(),
        },
        {
          id: "audit-1",
          action: "smoke.run",
          title: "운영 스모크 실행 (실 호출·과금)",
          method: "POST",
          path: "/ops/smoke",
          target: null,
          actorEmail: "admin@acos.local",
          outcome: "ok",
          statusCode: 200,
          durationMs: 1840,
          detail: null,
          requestId: "req-1",
          createdAt: new Date(Date.now() - 3600000).toISOString(),
        },
      ]),
    );
    return;
  }

  // ── Provider 연결 순서 (TASK-2901, CTO 결정 2801-⑤) ── ADMIN 전용
  if (url.pathname === "/ops/providers") {
    if (req.headers.authorization !== "Bearer stub-token") {
      res.statusCode = req.headers.authorization ? 403 : 401;
      res.end(JSON.stringify({ message: "ADMIN 권한이 필요합니다." }));
      return;
    }
    // OpenAI만 연결된 상태 — 다음 단계는 Anthropic이고, OCR은 가짜가 돈다
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        order: ["openai", "anthropic", "gemini", "vision", "ocr"],
        stages: [
          {
            stage: "openai",
            order: 1,
            title: "OpenAI",
            status: "connected",
            detail: "실 호출 성공 기록이 12건 있습니다 — 연결이 사실로 확인됐습니다.",
            done: true,
            env: ["OPENAI_API_KEY"],
            evidence: "실 호출 성공 12건",
          },
          {
            stage: "anthropic",
            order: 2,
            title: "Anthropic",
            status: "unverified",
            detail:
              "ANTHROPIC_API_KEY 형식은 확인했지만 성공한 실 호출 기록이 없습니다 — 실제로 붙는지는 아직 모릅니다.",
            done: false,
            env: ["ANTHROPIC_API_KEY"],
            evidence: null,
          },
          {
            stage: "gemini",
            order: 3,
            title: "Google Gemini",
            status: "not-configured",
            detail: "GEMINI_API_KEY가 없습니다 — 아직 붙이지 않은 상태입니다(실패가 아닙니다).",
            done: false,
            env: ["GEMINI_API_KEY"],
            evidence: null,
          },
          {
            stage: "vision",
            order: 4,
            title: "Vision (멀티모달 이미지 분석)",
            status: "connected",
            detail: "openai로 vision-analysis 성공 기록이 3건 있습니다.",
            done: true,
            env: ["LLM_PROVIDER", "LLM_MODEL_VISION"],
            evidence: "vision-analysis 성공 3건",
          },
          {
            stage: "ocr",
            order: 5,
            title: "OCR (이미지 텍스트 추출)",
            status: "mock",
            detail:
              "OCR_PROVIDER가 mock입니다 — 이미지에서 실제로 글자를 읽지 않고 가짜 텍스트를 만듭니다.",
            done: false,
            env: ["OCR_PROVIDER", "GOOGLE_VISION_API_KEY"],
            evidence: null,
          },
        ],
        next: "anthropic",
        outOfOrder: ["vision"],
        summary: { connected: 2, total: 5 },
        detail:
          "연결 완료 2/5단계 — 다음 단계는 Anthropic입니다. 확정 순서보다 먼저 붙은 단계가 있습니다: Vision (멀티모달 이미지 분석) — 막지는 않습니다.",
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
    url.pathname === "/llm/monitoring" ||
    // OCR 관측 (TASK-3001, CTO 결정 2901-④)
    url.pathname === "/llm/monitoring/ocr"
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
          // 원장별 합계 (TASK-3001) — 예산은 LLM+OCR을 합해서 본다
          bySource: healthy
            ? { llm: 0.181213, ocr: 0.003 }
            : { llm: 0, ocr: 0 },
          pricing: [
            { model: "gpt-4o", inputPerMillion: 2.5, outputPerMillion: 10 },
            { model: "claude-sonnet-5", inputPerMillion: 3, outputPerMillion: 15 },
          ],
          ocrPricing: [
            {
              provider: "google-vision",
              perUnitUsd: 0.0015,
              note: "TEXT_DETECTION 1,000단위당 $1.50 (공개 단가) — 무료 구간은 반영하지 않습니다",
            },
            { provider: "mock", perUnitUsd: 0, note: "가짜 엔진 — 외부 호출이 없어 과금 0" },
          ],
          checkedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    // OCR 관측 — LLM과 같은 판정 기준, 다른 표 (TASK-3001)
    if (url.pathname === "/llm/monitoring/ocr") {
      res.end(
        JSON.stringify({
          status: healthy ? "healthy" : "down",
          windowMinutes: Number(url.searchParams.get("minutes")) || 60,
          minSamples: 5,
          totals: {
            calls: healthy ? 12 : 8,
            successCount: healthy ? 12 : 0,
            failedCount: healthy ? 0 : 8,
            successRate: healthy ? 1 : 0,
            cost: healthy ? 0.018 : null,
            unpricedCalls: healthy ? 0 : 8,
          },
          providers: [
            {
              provider: "google-vision",
              model: "text-detection",
              status: healthy ? "healthy" : "down",
              calls: healthy ? 12 : 8,
              successCount: healthy ? 12 : 0,
              successRate: healthy ? 1 : 0,
              cost: healthy ? 0.018 : null,
              unpricedCalls: healthy ? 0 : 8,
              latency: healthy
                ? { p50: 240, p95: 520, p99: 610, max: 640 }
                : null,
            },
          ],
          alerts: healthy
            ? []
            : [
                {
                  level: "critical",
                  provider: "google-vision",
                  message: "OCR 엔진 성공률 0% — 키·할당량·Google 장애를 확인하세요.",
                },
              ],
          diagnosticCalls: 0,
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
        // KPI 임계값 범위 (TASK-3901 정책 3901-② · TASK-4001 정책 4001-③).
        // 범위 밖의 값은 임계값이 아니라 **임계값을 없앤 것**이고, 화면이
        // 그 거절을 그대로 보여 주는지가 이 스텁으로 검증된다.
        if (key === "kpi.threshold.mttr.watch" && value !== null && Number(value) > 1440) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              message:
                `평균 복구 시간 임계값은 5~1440분 사이여야 합니다 (받은 값: ${value}분). ` +
                "범위 밖의 값은 임계값이 아니라 임계값을 없앤 것이고, 그건 설정이 아니라 우회입니다.",
            }),
          );
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

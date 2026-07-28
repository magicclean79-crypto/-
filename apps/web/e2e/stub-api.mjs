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
  byProvider: groups.length
    ? [{ key: "mock", stats: totals }]
    : [],
  byModel: groups.length
    ? [{ key: "mock-llm-1", stats: totals }]
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
  res.setHeader("access-control-allow-origin", "*");
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
      res.end(JSON.stringify({ mode }));
    });
    return;
  }

  // ── 인증 (TASK-0801) ──
  if (req.method === "POST" && url.pathname === "/auth/login") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { email, password } = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      if (email === "admin@acos.local" && password === "admin1234") {
        res.end(
          JSON.stringify({
            token: "stub-token",
            expiresAt: "2027-01-01T00:00:00.000Z",
            user: {
              id: "u-1",
              email: "admin@acos.local",
              name: "관리자",
              role: "ADMIN",
              createdAt: "2026-07-28T00:00:00.000Z",
            },
          }),
        );
      } else {
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

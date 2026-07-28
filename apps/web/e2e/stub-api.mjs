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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "POST" && url.pathname === "/__mode") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      mode = JSON.parse(body).mode;
      lastUrls = [];
      res.end(JSON.stringify({ mode }));
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

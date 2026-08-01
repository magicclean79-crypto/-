#!/usr/bin/env node
/**
 * Google Cloud Vision **계약 스텁**. (TASK-4701, Sprint 47 — 지시 4)
 *
 * ## 이것은 Google이 아닙니다
 *
 * `images:annotate`의 요청·응답 **계약만** 흉내 냅니다. 이 스텁으로 확인할
 * 수 있는 것: HTTP 경로 · 요청 본문 형식 · 응답 파싱 · 상태 코드별 문구 ·
 * 실행 이력 기록. 확인할 수 **없는** 것: 실제 키의 유효성, Google의 실제
 * 인식 품질, 그리고 진짜 장애가 어떤 모양인지.
 *
 * 이 파일이 저장소에 들어온 이유는 CI에서 라이브 검사를 돌리기
 * 위해서입니다(지금까지는 사람의 임시 파일이었습니다). 임시 파일에 기대는
 * 검사는 **그 사람이 없으면 못 돌립니다.**
 *
 * ## 모드
 *
 * `POST /__mode {"mode": "...", "delayMs": n}` 으로 바꿉니다.
 *
 * | 모드 | 무엇을 흉내 내는가 |
 * | --- | --- |
 * | `ok` | 정상 |
 * | `outage` | 상대 서버 장애 (503) — **다시 해 볼 만한 실패** |
 * | `unauthorized` | 키가 틀림 (403) — 한 건의 문제가 될 수 없다 |
 * | `quota` | 할당량 초과 (429) |
 * | `empty` | 200인데 글자가 없음 — **성공으로 기록되는 실패** |
 * | `garbage` | JSON이 아님 |
 *
 * `delayMs`는 응답을 늦춥니다. 프로세스를 죽여 "돌다 만 작업"을 만들려면
 * 죽이는 순간 **실제로 돌고 있어야** 하기 때문입니다.
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 9100);
let mode = "ok";
let delayMs = 0;
const calls = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/__mode") {
    if (req.method !== "POST") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ mode, delayMs }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      mode = parsed.mode ?? "ok";
      delayMs = Number(parsed.delayMs ?? 0) || 0;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ mode, delayMs }));
    });
    return;
  }

  if (url.pathname === "/__calls") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ calls: calls.length }));
    return;
  }

  if (url.pathname !== "/v1/images:annotate" || req.method !== "POST") {
    res.statusCode = 404;
    res.end("{}");
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const request = payload.requests?.[0] ?? {};
    // **키 값은 기록하지 않습니다** — 존재 여부만 남깁니다. 스텁의 로그도
    // 로그이고, 로그는 가장 많이 복사되는 텍스트입니다.
    calls.push({
      hasKey: url.searchParams.has("key"),
      features: request.features,
      imageBytes: Buffer.from(request.image?.content ?? "", "base64").length,
    });

    const send = (fn) => (delayMs > 0 ? setTimeout(fn, delayMs) : fn());
    res.setHeader("content-type", "application/json");

    if (mode === "unauthorized") {
      res.statusCode = 403;
      send(() => res.end(JSON.stringify({ error: { message: "API key not valid" } })));
      return;
    }
    if (mode === "quota") {
      res.statusCode = 429;
      send(() => res.end(JSON.stringify({ error: { message: "Quota exceeded" } })));
      return;
    }
    if (mode === "outage") {
      res.statusCode = 503;
      send(() => res.end(JSON.stringify({ error: { message: "Backend unavailable" } })));
      return;
    }
    if (mode === "garbage") {
      send(() => res.end("<html>not json</html>"));
      return;
    }
    if (mode === "empty") {
      send(() => res.end(JSON.stringify({ responses: [{}] })));
      return;
    }
    send(() =>
      res.end(
        JSON.stringify({
          responses: [
            {
              fullTextAnnotation: {
                text: "매직클린 다목적 청소포\n500ml\n사용 후 물로 충분히 헹구세요.",
                pages: [{ confidence: 0.94 }],
              },
            },
          ],
        }),
      ),
    );
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`google-vision contract stub on 127.0.0.1:${PORT}`);
});

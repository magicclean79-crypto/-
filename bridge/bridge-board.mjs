/**
 * CTO Bridge — 사람이 브라우저에서 보는 현황판 (읽기 전용)
 *
 * ## 왜 별도 서버인가
 *
 * Bridge 본체(4200)는 **터널을 통해 바깥에 열려 있다.** 거기에 토큰 없이
 * 열리는 화면을 붙이면 작업 내용이 인터넷에 그대로 노출된다. cloudflared는
 * `127.0.0.1:4200` 으로 붙기 때문에 "요청이 loopback에서 왔는가"로는
 * 바깥과 안을 구분할 수 없다 — 터널을 타고 온 요청도 127.0.0.1로 보인다.
 *
 * 그래서 화면은 **터널이 닿지 않는 다른 포트**에 따로 둔다.
 *
 *   Bridge 본체 4200  ← 터널 연결됨 · 토큰 필요
 *   현황판     4201  ← 이 PC에서만 · 읽기 전용 · 쓰기 경로 없음
 *
 * ## 하지 않는 것
 *
 * 상태를 바꾸지 않는다. 작업을 만들지 않는다. Claude를 부르지 않는다.
 * GET 말고는 받지 않는다. **볼 수만 있는 창**이다.
 *
 * 실행:  node bridge/bridge-board.mjs
 */

import { createServer } from "node:http";
import { listTasks, readResult } from "./bridge-io.mjs";
import { summarize } from "./bridge-state.mjs";
import { listProjects } from "./bridge-projects.mjs";

const PORT = Number(process.env.BRIDGE_BOARD_PORT ?? 4201);
const HOST = "127.0.0.1"; // 절대 0.0.0.0으로 열지 않는다 — 터널이 닿으면 안 된다

const STATE_LABEL = {
  REQUESTED: "대기 중",
  IN_PROGRESS: "실행 중",
  TESTING: "검증 중",
  READY_FOR_REVIEW: "사람 확인 대기",
  COMPLETED: "완료",
  BLOCKED: "사장님 결정 대기",
};

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/** 얼마나 지났는지 사람 말로 */
function elapsed(fromIso, toIso) {
  const from = Date.parse(fromIso ?? "");
  if (!Number.isFinite(from)) return "-";
  const to = Number.isFinite(Date.parse(toIso ?? "")) ? Date.parse(toIso) : Date.now();
  const sec = Math.max(0, Math.round((to - from) / 1000));
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 ${sec % 60}초`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

function renderRow(row, result) {
  // **"실행 중"은 IN_PROGRESS 뿐이다.** TESTING은 Claude 호출이 이미 끝나고
  // 사람 확인 단계로 못 올라간 상태다 — 돌고 있는 것처럼 보이면 안 된다.
  const live = row.state === "IN_PROGRESS";
  // 검사 값은 문자열일 수도, {ok, detail} 일 수도 있다.
  const tests = Object.entries(result?.testResults ?? {})
    .map(([k, v]) => {
      const isObject = v && typeof v === "object";
      const mark = isObject ? (v.ok ? "통과" : "실패") : "";
      const text = isObject ? (v.detail ?? "") : v;
      return `<div class="kv ${isObject && !v.ok ? "bad" : ""}"><b>${escapeHtml(k)}</b>${
        mark ? ` <em>${mark}</em>` : ""
      } ${escapeHtml(text)}</div>`;
    })
    .join("");
  const work = (result?.workDone ?? [])
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");

  return `
    <article class="task ${row.state}">
      <header>
        <span class="id">${escapeHtml(row.taskId)}</span>
        <span class="title">${escapeHtml(row.title)}</span>
        <span class="state">${escapeHtml(STATE_LABEL[row.state] ?? row.state)}</span>
      </header>
      <div class="meta">
        ${live ? `<span class="pulse">● 진행 ${escapeHtml(elapsed(row.startedAt))}</span>` : ""}
        ${row.finishedAt ? `<span>소요 ${escapeHtml(elapsed(row.startedAt, row.finishedAt))}</span>` : ""}
        ${row.heartbeatAt && live ? `<span>마지막 신호 ${escapeHtml(elapsed(row.heartbeatAt))} 전</span>` : ""}
        ${row.costIncurred ? `<span class="cost">비용 발생</span>` : ""}
      </div>
      ${
        row.state === "BLOCKED" && Array.isArray(row.decisionNeeded)
          ? `<div class="decision"><b>사장님이 정해 주셔야 진행됩니다</b><ul>${row.decisionNeeded
              .map(
                (d) =>
                  `<li>${escapeHtml(d.question)}${
                    Array.isArray(d.options) && d.options.length > 0
                      ? `<br><span class="opts">선택지: ${escapeHtml(d.options.join(" / "))}</span>`
                      : ""
                  }${d.why ? `<br><span class="opts">스스로 정할 수 없는 이유: ${escapeHtml(d.why)}</span>` : ""}</li>`,
              )
              .join("")}</ul></div>`
          : ""
      }
      ${row.blockedOn ? `<p class="blocked">막힘 — ${escapeHtml(row.blockedOn)}</p>` : ""}
      ${tests ? `<div class="tests">${tests}</div>` : ""}
      ${work ? `<ul class="work">${work}</ul>` : ""}
      ${
        row.state === "READY_FOR_REVIEW" && row.browserUrl
          ? `<p class="review">확인할 곳 → <a href="${escapeHtml(row.browserUrl)}">${escapeHtml(row.browserUrl)}</a></p>`
          : ""
      }
    </article>`;
}

function renderProject(project) {
  const rows = listTasks(project.projectId).map((t) => {
    const result = readResult(t.taskId, project.projectId);
    return { row: summarize(t, result), result };
  });
  const counts = {
    live: rows.filter(({ row }) => row.state === "IN_PROGRESS").length,
    stuck: rows.filter(({ row }) => row.state === "TESTING").length,
    review: rows.filter(({ row }) => row.state === "READY_FOR_REVIEW").length,
    blocked: rows.filter(({ row }) => row.state === "BLOCKED").length,
  };
  const html = `
    <section class="project">
      <h2>${escapeHtml(project.name)} <span class="pid">${escapeHtml(project.projectId)}</span></h2>
      <p class="repo">${escapeHtml(project.repoPath)}</p>
      ${rows.length === 0 ? `<p class="repo">등록된 작업이 없습니다.</p>` : ""}
      ${rows.map(({ row, result }) => renderRow(row, result)).join("")}
    </section>`;
  return { html, counts };
}

function renderPage() {
  const projects = listProjects().map(renderProject);
  const total = projects.reduce(
    (acc, p) => ({
      live: acc.live + p.counts.live,
      stuck: acc.stuck + p.counts.stuck,
      review: acc.review + p.counts.review,
      blocked: acc.blocked + p.counts.blocked,
    }),
    { live: 0, stuck: 0, review: 0, blocked: 0 },
  );

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CTO Bridge 현황판</title>
<meta http-equiv="refresh" content="5">
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1a1a1a; --dim:#666; --line:#e3e3e3; --card:#fafafa; --accent:#0b6; --warn:#c60; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#161616; --fg:#eee; --dim:#999; --line:#2e2e2e; --card:#1e1e1e; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); color:var(--fg);
         font-family: "Malgun Gothic", system-ui, sans-serif; line-height:1.6; }
  .wrap { max-width: 60rem; margin: 0 auto; }
  h1 { font-size:1.35rem; margin:0 0 .25rem; }
  .sub { color:var(--dim); font-size:.85rem; margin:0 0 1.5rem; }
  .banner { padding:.75rem 1rem; border-radius:.5rem; margin-bottom:1.5rem; font-size:.92rem; }
  .banner.live { background:rgba(0,187,102,.12); border:1px solid var(--accent); }
  .banner.idle { background:var(--card); border:1px solid var(--line); color:var(--dim); }
  article.task { border:1px solid var(--line); border-radius:.6rem; padding:1rem 1.15rem;
                 margin-bottom:.9rem; background:var(--card); }
  article.task.IN_PROGRESS, article.task.TESTING { border-color:var(--accent); }
  article.task.READY_FOR_REVIEW { border-color:var(--warn); }
  header { display:flex; gap:.75rem; align-items:baseline; flex-wrap:wrap; }
  .id { font-weight:700; font-family:Consolas,monospace; }
  .title { flex:1; min-width:12rem; }
  .state { font-size:.8rem; padding:.15rem .6rem; border:1px solid var(--line);
           border-radius:1rem; color:var(--dim); white-space:nowrap; }
  .IN_PROGRESS .state, .TESTING .state { color:var(--accent); border-color:var(--accent); }
  .READY_FOR_REVIEW .state { color:var(--warn); border-color:var(--warn); }
  article.task.BLOCKED { border-color:var(--warn); }
  .BLOCKED .state { color:var(--warn); border-color:var(--warn); }
  .banner.decide { background:rgba(204,102,0,.12); border:1px solid var(--warn); }
  .decision { margin-top:.6rem; padding:.6rem .85rem; border-left:3px solid var(--warn);
              background:rgba(204,102,0,.07); font-size:.88rem; }
  .decision ul { margin:.4rem 0 0; padding-left:1.1rem; }
  .decision .opts { color:var(--dim); font-size:.82rem; }
  section.project { margin-bottom:2.5rem; }
  section.project h2 { font-size:1.02rem; margin:0 0 .1rem; }
  .pid { font-family:Consolas,monospace; font-size:.78rem; color:var(--dim);
         border:1px solid var(--line); border-radius:1rem; padding:.1rem .55rem; margin-left:.4rem; }
  .repo { font-size:.78rem; color:var(--dim); margin:0 0 .8rem; word-break:break-all; }
  .meta { display:flex; gap:1rem; flex-wrap:wrap; font-size:.8rem; color:var(--dim); margin-top:.35rem; }
  .pulse { color:var(--accent); }
  .cost { color:var(--warn); }
  .blocked { font-size:.85rem; color:var(--warn); margin:.5rem 0 0; }
  .tests { display:flex; gap:.5rem 1.25rem; flex-wrap:wrap; margin-top:.6rem; font-size:.82rem; }
  .kv b { font-weight:600; margin-right:.35rem; }
  .kv em { font-style:normal; color:var(--accent); }
  .kv.bad em { color:var(--warn); }
  ul.work { margin:.6rem 0 0; padding-left:1.2rem; font-size:.85rem; color:var(--dim); }
  .review { margin:.6rem 0 0; font-size:.88rem; }
  footer { margin-top:2rem; font-size:.78rem; color:var(--dim); border-top:1px solid var(--line); padding-top:1rem; }
  table.overflow { display:block; overflow-x:auto; }
</style>
</head>
<body>
<div class="wrap">
  <h1>CTO Bridge 현황판</h1>
  <p class="sub">5초마다 자동 새로고침 · 읽기 전용 · 이 PC에서만 열립니다</p>

  ${
    total.blocked > 0
      ? `<div class="banner decide"><b>${total.blocked}건이 사장님 결정을 기다립니다</b> — 아래 주황색 상자에 무엇을 정해 주셔야 하는지 적혀 있습니다.</div>`
      : ""
  }
  ${
    total.live > 0
      ? `<div class="banner live"><b>${total.live}건 실행 중</b> — 요청은 이미 응답이 끝났고, Claude Code는 뒤에서 계속 일하고 있습니다. 이 화면이 바뀌는 것으로 확인하십시오.</div>`
      : `<div class="banner idle">지금 실행 중인 작업이 없습니다.</div>`
  }

  ${projects.map((p) => p.html).join("")}

  <footer>
    프로젝트 ${projects.length}개 · 실행 중 ${total.live}건 · 검증 단계에 멈춤 ${total.stuck}건 ·
    사장님 결정 대기 ${total.blocked}건 · 사람 확인 대기 ${total.review}건<br>
    Bridge 본체는 4200(토큰 필요), 이 화면은 4201(이 PC 전용)입니다.
    상태를 바꾸는 경로는 이 화면에 없습니다.
  </footer>
</div>
</body>
</html>`;
}

const server = createServer((req, res) => {
  // **읽기만 한다.** 다른 메서드는 아예 받지 않는다.
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("이 화면은 읽기 전용입니다.");
  }
  const path = new URL(req.url, "http://localhost").pathname.replace(/\/+$/, "") || "/";
  if (path !== "/") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("없는 경로입니다.");
  }
  const html = renderPage();
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
});

server.listen(PORT, HOST, () => {
  console.log(`CTO Bridge 현황판: http://localhost:${PORT}`);
  console.log("  읽기 전용 · 이 PC에서만 접근 가능 · 터널에 연결되지 않음");
});

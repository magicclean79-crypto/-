#!/usr/bin/env node
/**
 * /level2-generate/:generationId 브라우저 접속 회귀 게이트 (T1-201).
 *
 * "3100 상세페이지 route → 4100 API → generation → asset" 전체 연결
 * 고리를 자동으로 확인한다. Gemini/OpenAI 실 호출은 하지 않는다 — 이미
 * 존재하는 generation을 GET으로만 읽는다(과금 없음).
 *
 * 전제: scripts/start-verify-studio.ps1 로 띄운 로컬 API(4100)·Web(3100)이
 * 이미 떠 있어야 한다 — 이 스크립트가 서버를 대신 띄우지 않는다
 * (check-image-studio-smoke.mjs와 같은 원칙).
 *
 * 사용법:
 *   node scripts/check-detail-page-connectivity-smoke.mjs
 *   node scripts/check-detail-page-connectivity-smoke.mjs <generationId> [<generationId2> ...]
 *   API_URL=http://localhost:4100 WEB_URL=http://localhost:3100 node scripts/check-detail-page-connectivity-smoke.mjs
 *
 * 판정: 모든 단계 통과 시 exit 0, 하나라도 실패하면 exit 1.
 */
import { createRequire } from "node:module";

const API_URL = process.env.API_URL ?? "http://localhost:4100";
const WEB_URL = process.env.WEB_URL ?? "http://localhost:3100";

// 기본값: 실제로 생성된 두 회귀 대상(T1-201 요청문에 명시).
// T1-197 — 실 판매용 상세페이지 디자인 시스템 재생성 결과
// T1-196 — OCR 강화 + 섹션별 제품 설명 연결 결과
const DEFAULT_GENERATION_IDS = ["cmt6jnzbr0001ul2gim2mwznv", "cmt5w3vlm0001ulo8qrbc3aqt"];

const results = [];
let failed = false;

function report(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${step}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body, headers: res.headers };
}

async function checkGenerationChain(id) {
  const genUrl = `${API_URL}/level1/multi-generations/${id}`;
  const gen = await getJson(genUrl);
  if (!gen.ok) {
    report(`[${id}] API generation 조회`, false, `HTTP ${gen.status} (${genUrl})`);
    return;
  }
  report(`[${id}] API generation 조회`, true, `status=${gen.body?.status}`);

  const pages = Array.isArray(gen.body?.pages) ? gen.body.pages : [];
  const succeeded = pages.filter((p) => p.status === "SUCCEEDED");
  report(`[${id}] 성공한 페이지 존재`, succeeded.length > 0, `${succeeded.length}/${pages.length}건 SUCCEEDED`);

  for (const page of succeeded) {
    const fileUrl = `${API_URL}/level1/multi-generations/pages/${page.id}/file`;
    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(10_000) });
    const contentType = res.headers.get("content-type") ?? "";
    report(
      `[${id}] 페이지 asset ${page.pageRole ?? page.id} 조회`,
      res.ok && contentType.startsWith("image/"),
      `HTTP ${res.status}, content-type=${contentType}`,
    );
  }

  // 웹 route가 실제로 200을 반환하는지 (Next.js route가 build 시점과
  // runtime에서 일치하는지 — stale build/404 여부)
  const webUrl = `${WEB_URL}/level2-generate/${id}`;
  try {
    const webRes = await fetch(webUrl, { signal: AbortSignal.timeout(10_000) });
    report(`[${id}] 웹 route HTTP 상태`, webRes.status === 200, `HTTP ${webRes.status} (${webUrl})`);
  } catch (err) {
    report(`[${id}] 웹 route HTTP 상태`, false, `연결 실패: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // 실 Chromium으로 열어 console/page error·broken image까지 확인.
  // 데스크톱(1280) · 모바일(390) 두 뷰포트 모두 확인한다(T1-202 요청 명시).
  const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const { chromium } = requireFromWeb("@playwright/test");
  const browser = await chromium.launch();
  try {
    for (const viewport of [
      { label: "desktop(1280)", width: 1280, height: 900 },
      { label: "mobile(390)", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => pageErrors.push(String(err)));

      const response = await page.goto(webUrl, { waitUntil: "networkidle", timeout: 30_000 });
      // 로딩 상태가 끝나고 에러 배너 또는 실제 콘텐츠가 뜰 때까지 대기
      await page
        .waitForSelector('[data-testid="detail-page-loading"]', { state: "detached", timeout: 20_000 })
        .catch(() => {});

      const errorBanner = await page.$('[data-testid="detail-page-error"]');
      const errorText = errorBanner ? await errorBanner.textContent() : null;
      report(`[${id}] ${viewport.label} 화면에 오류 배너 없음`, !errorBanner, errorText ?? "");

      /* eslint-disable no-undef -- 브라우저 컨텍스트(Playwright page.evaluate)에서 실행되는 콜백. document는 Node가 아니라 페이지의 전역이다. */
      const metrics = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        const broken = imgs.filter((img) => !img.complete || img.naturalWidth === 0).length;
        return { totalImgs: imgs.length, brokenImgs: broken };
      });
      /* eslint-enable no-undef */
      report(
        `[${id}] ${viewport.label} Chromium HTTP 상태`,
        response ? response.status() === 200 : false,
        `HTTP ${response?.status()}`,
      );
      report(`[${id}] ${viewport.label} console error 0건`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
      report(`[${id}] ${viewport.label} page error 0건`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
      report(
        `[${id}] ${viewport.label} broken image 0건`,
        metrics.brokenImgs === 0,
        `${metrics.brokenImgs}/${metrics.totalImgs}장`,
      );

      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_GENERATION_IDS;

  console.log(`API_URL=${API_URL}`);
  console.log(`WEB_URL=${WEB_URL}`);
  console.log(`대상 generation: ${ids.join(", ")}`);
  console.log("");

  const apiHealth = await getJson(`${API_URL}/health`).catch((err) => ({ ok: false, status: 0, err }));
  report("API health", apiHealth.ok === true, `HTTP ${apiHealth.status}`);

  for (const id of ids) {
    await checkGenerationChain(id);
  }

  console.log("");
  console.log(`결과: ${results.filter((r) => r.ok).length}/${results.length} 통과`);
  if (failed) {
    console.log("실패 항목:");
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.step}: ${r.detail}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

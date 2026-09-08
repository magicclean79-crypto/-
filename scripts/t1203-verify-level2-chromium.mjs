#!/usr/bin/env node
/**
 * T1-203 — LEVEL2 상세페이지(/level2-generate/:id) 자동 Chromium smoke test.
 *
 * 대상 URL을 실 Chromium(Playwright, 사전 설치본)으로 열어 HTTP status·
 * console error·page error·broken image를 1280px(desktop)·390px(mobile)
 * 두 뷰포트에서 실측한다. 결정론적으로 끝난다 — 내부에 무한 대기가 없고,
 * 각 페이지 로드는 고정 timeout(30초)을 넘기면 그 자체로 실패로 기록된다.
 *
 * 사용법: node scripts/t1203-verify-level2-chromium.mjs <baseUrl> <id1> [id2 ...]
 *   기본값(인자 없이 실행하면) T1-197·T1-196 benchmark ID 두 개를 확인한다.
 *
 * 종료 코드: 모든 URL이 두 뷰포트 모두에서 HTTP 200·console/page error 0·
 * broken image 0이면 0, 하나라도 어긋나면 1.
 */
import { createRequire } from "node:module";

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = requireFromWeb("@playwright/test");

const DEFAULT_BASE_URL = "http://localhost:3100";
const DEFAULT_IDS = [
  "cmt6jnzbr0001ul2gim2mwznv", // T1-197
  "cmt5w3vlm0001ulo8qrbc3aqt", // T1-196
];
const PAGE_TIMEOUT_MS = 30_000;

async function checkViewport(page, url, width, label) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  let httpStatus = null;
  let navError = null;
  try {
    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto(url, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
    httpStatus = response ? response.status() : null;
    await page.waitForTimeout(500);
  } catch (error) {
    navError = String(error);
  }

  // Playwright가 브라우저 context에 주입해 실행하는 콜백이다 —
  // `document`는 Node가 아니라 브라우저 전역이다.
  const browserImageCheck = () => {
    // eslint-disable-next-line no-undef
    const imgs = Array.from(document.querySelectorAll("img"));
    const broken = imgs.filter((img) => !img.complete || img.naturalWidth === 0).length;
    return { totalImgs: imgs.length, brokenImgs: broken };
  };
  const metrics = navError ? { totalImgs: 0, brokenImgs: 0 } : await page.evaluate(browserImageCheck);

  return {
    label,
    width,
    url,
    httpStatus,
    navError,
    consoleErrors,
    pageErrors,
    metrics,
    pass: !navError && httpStatus === 200 && consoleErrors.length === 0 && pageErrors.length === 0 && metrics.brokenImgs === 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const baseUrl = args[0] || DEFAULT_BASE_URL;
  const ids = args.length > 1 ? args.slice(1) : DEFAULT_IDS;

  const browser = await chromium.launch();
  const results = [];
  try {
    for (const id of ids) {
      const url = `${baseUrl}/level2-generate/${id}`;
      const desktopPage = await browser.newPage();
      const desktop = await checkViewport(desktopPage, url, 1280, "desktop-1280");
      await desktopPage.close();

      const mobilePage = await browser.newPage();
      const mobile = await checkViewport(mobilePage, url, 390, "mobile-390");
      await mobilePage.close();

      results.push({ id, url, desktop, mobile });
    }
  } finally {
    await browser.close();
  }

  const allPass = results.every((r) => r.desktop.pass && r.mobile.pass);
  const summary = { allPass, results };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

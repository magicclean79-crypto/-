#!/usr/bin/env node
/**
 * T1-183 — 로컬 3100 웹 서버에서 실제로 서비스되는 benchmark 상세페이지
 * (/product-profile/:id/final-html)를 실 Chromium(Playwright)으로 열어
 * 1280px(desktop)·390px(mobile) 스크린샷을 찍고, console/page error·
 * broken image·overflow를 실측한다.
 *
 * 사용법: node scripts/t1183-verify-chromium.mjs <productProfileId> [baseUrl]
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = requireFromWeb("@playwright/test");

async function checkViewport(page, url, width, label, outDir) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.setViewportSize({ width, height: 1000 });
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(500);

  // 지연 로드 이미지 전부 트리거 — 스크롤 끝까지
  // 아래 콜백은 Playwright가 브라우저 context에 주입해 실행한다 —
  // `window`/`document`는 Node가 아니라 브라우저 전역이다.
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const step = 800;
      const timer = setInterval(() => {
        // eslint-disable-next-line no-undef
        window.scrollBy(0, step);
        total += step;
        // eslint-disable-next-line no-undef
        if (total > document.body.scrollHeight + 2000) {
          clearInterval(timer);
          resolve(undefined);
        }
      }, 60);
    });
  });
  await page.waitForTimeout(800);
  // eslint-disable-next-line no-undef
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const metrics = await page.evaluate(() => {
    // eslint-disable-next-line no-undef
    const imgs = Array.from(document.querySelectorAll("img"));
    const broken = imgs.filter((img) => !img.complete || img.naturalWidth === 0).length;
    // eslint-disable-next-line no-undef
    const heroMedia = document.querySelector(".pde-story-hero-media");
    // eslint-disable-next-line no-undef
    const galleryStrips = Array.from(document.querySelectorAll(".pde-story-gallery-strip"));
    const galleryCellRects = galleryStrips.flatMap((ul) =>
      Array.from(ul.querySelectorAll("li")).map((li) => {
        const r = li.getBoundingClientRect();
        return Math.round((r.width / r.height) * 100) / 100;
      }),
    );
    // eslint-disable-next-line no-undef
    const iconFamily = document.querySelector(".pde-story-icon[data-icon-source]")?.getAttribute("data-icon-source");
    // eslint-disable-next-line no-undef
    const bodyWidth = document.body.scrollWidth;
    // eslint-disable-next-line no-undef
    const viewportWidth = window.innerWidth;
    return {
      totalImgs: imgs.length,
      brokenImgs: broken,
      heroPresent: Boolean(heroMedia),
      heroAspectAttr: heroMedia?.getAttribute("data-hero-aspect") ?? null,
      galleryCellCount: galleryCellRects.length,
      galleryCellAspectRatios: galleryCellRects,
      iconSource: iconFamily ?? null,
      bodyScrollWidth: bodyWidth,
      viewportWidth,
      hasHorizontalOverflow: bodyWidth > viewportWidth + 2,
    };
  });

  mkdirSync(outDir, { recursive: true });
  const shotPath = `${outDir}/${label}.png`;
  await page.screenshot({ path: shotPath, fullPage: true });

  return {
    label,
    width,
    httpStatus: response ? response.status() : null,
    consoleErrors,
    pageErrors,
    metrics,
    shotPath,
  };
}

async function main() {
  const id = process.argv[2] || "cmskff85t0050uldwtre10ah2";
  const baseUrl = process.argv[3] || "http://127.0.0.1:3100";
  const url = `${baseUrl}/product-profile/${id}/final-html`;
  const outDir = "C:/Users/82104/Documents/GitHub/-.worktrees/claude-chatbot-integration/.tmp-t1183-screens";

  const browser = await chromium.launch();
  try {
    const desktopPage = await browser.newPage();
    const desktop = await checkViewport(desktopPage, url, 1280, "desktop-1280", outDir);
    await desktopPage.close();

    const mobilePage = await browser.newPage();
    const mobile = await checkViewport(mobilePage, url, 390, "mobile-390", outDir);
    await mobilePage.close();

    console.log(JSON.stringify({ desktop, mobile }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

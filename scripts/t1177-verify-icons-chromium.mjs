#!/usr/bin/env node
/**
 * T1-177 — DB에 저장된 storyResult.html/css를 그대로 static HTML 문서로
 * 감싸 실제 Chromium(Playwright)에서 열어 아이콘 렌더링을 검증한다.
 *
 * 로컬 3100/4100 개발 서버 포트를 전혀 쓰지 않는다(file:// 로드) — 이
 * 저장소의 Playwright e2e 스위트(apps/web)가 그 포트를 점유 중이어도
 * 이 검증과 충돌하지 않는다. 검증하는 것은 오직 "이 HTML 문서가 실제
 * 브라우저 렌더 엔진에서 콘솔 오류 없이 열리고, DESIGN_PROFILE canonical
 * SVG 아이콘이 실제로 나타나며, 깨진 Unicode/emoji 아이콘이 없는가"이다.
 *
 * 사용법: node scripts/t1177-verify-icons-chromium.mjs <productProfileId>
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");
const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = requireFromWeb("@playwright/test");

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("사용법: node scripts/t1177-verify-icons-chromium.mjs <productProfileId>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const record = await prisma.productProfile.findUnique({
    where: { id },
    select: { id: true, storyResult: true, designProfile: true },
  });
  await prisma.$disconnect();

  if (!record?.storyResult) {
    console.error(`storyResult가 없습니다: ${id}`);
    process.exit(1);
  }

  const { html, css } = record.storyResult;
  const doc = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>T1-177 검증</title><style>${css}</style></head><body>${html}</body></html>`;
  const dir = mkdtempSync(join(tmpdir(), "t1177-icon-verify-"));
  const filePath = join(dir, "final-html.html");
  writeFileSync(filePath, doc, "utf-8");

  const browser = await chromium.launch();
  const consoleErrors = [];
  const pageErrors = [];

  for (const viewport of [
    { width: 1280, height: 900, label: "1280" },
    { width: 390, height: 844, label: "390" },
  ]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[${viewport.label}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[${viewport.label}] ${err.message}`));

    await page.goto(`file://${filePath}`, { waitUntil: "load" });

    const iconCount = await page.locator('[data-icon-source="design-profile-svg"]').count();
    const svgCount = await page.locator('[data-icon-source="design-profile-svg"] svg').count();
    const generativeIconCount = await page.locator('[data-icon-source="gemini-generative-design"]').count();
    const legacyFallbackCount = await page.locator('[data-icon-source="fallback-svg"]').count();
    const bodyText = await page.locator("body").innerText();
    // eslint 이모지 대역 검사와 동일한 범위 — 페이지 텍스트에 깨진 이모지/유니코드 아이콘이 없는지
    const hasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bodyText);
    const strokeWidths = await page
      .locator('[data-icon-source="design-profile-svg"] svg')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("stroke-width")));

    console.log(`\n== viewport ${viewport.label} ==`);
    console.log("icon badge count:", iconCount, "| svg 렌더된 아이콘 수:", svgCount);
    console.log("생성형 아이콘(gemini-generative-design) 잔존 수(기대값 0):", generativeIconCount);
    console.log("구 fallback-svg 잔존 수(기대값 0):", legacyFallbackCount);
    console.log("본문에 깨진 emoji/유니코드 아이콘 존재:", hasEmoji);
    console.log("아이콘 stroke-width 목록:", strokeWidths);

    await page.screenshot({ path: join(dir, `screenshot-${viewport.label}.png`), fullPage: false });
    await page.close();
  }

  await browser.close();

  console.log("\n== 콘솔/페이지 오류 ==");
  console.log("console errors:", consoleErrors.length, consoleErrors);
  console.log("page errors:", pageErrors.length, pageErrors);
  console.log("\n스크린샷 저장 위치:", dir);
  console.log("designProfile.icon (참고):", JSON.stringify(record.designProfile?.icon ?? null));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
